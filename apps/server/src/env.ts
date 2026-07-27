/**
 * Boot-time environment validation — the ONE place the process decides whether
 * its configuration is usable.
 *
 * `validateEnv` is pure: it takes a plain record and returns a result. That is
 * what the unit tests call. `loadEnv` is the impure wrapper the process boots
 * through: on failure it logs every problem and exits non-zero. It does not
 * warn and continue (ADR 0005 — a dev fallback that reaches production is a
 * forged-identity bug).
 *
 * | Variable       | Required        | Default       |
 * | -------------- | --------------- | ------------- |
 * | NODE_ENV       | no              | development   |
 * | PORT           | no              | 3001          |
 * | DATABASE_URL   | yes             | —             |
 * | TEAM_CODE      | yes in prod     | —             |
 * | SESSION_SECRET | yes in prod     | — (>= 32 chars, no fallback) |
 * | APP_TIMEZONE   | no              | UTC           |
 */

import { logger } from './logger';

export const SESSION_SECRET_MIN_LENGTH = 32;
export const DEFAULT_PORT = 3001;
export const DEFAULT_TIMEZONE = 'UTC';

export type NodeEnv = 'development' | 'test' | 'production';

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type AppConfig = {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** Required in production; `null` elsewhere when unset. Consumed from Stage 2. */
  teamCode: string | null;
  /** Required in production; `null` elsewhere when unset. Never has a default. */
  sessionSecret: string | null;
  /** A valid IANA zone name (ADR 0008). */
  appTimezone: string;
};

export type EnvValidationResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: readonly string[] };

function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** True when `Intl` accepts the zone. An unknown zone throws a `RangeError`. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure. Never throws, never reads `process.env`, never exits — it reports every
 * problem it finds so a misconfigured host sees the whole list at once.
 */
export function validateEnv(source: EnvSource): EnvValidationResult {
  const errors: string[] = [];

  // NODE_ENV
  const rawNodeEnv = trimmedOrUndefined(source.NODE_ENV) ?? 'development';
  const nodeEnv = NODE_ENVS.find((candidate) => candidate === rawNodeEnv);
  if (nodeEnv === undefined) {
    errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')} (received "${rawNodeEnv}").`);
  }
  const isProduction = rawNodeEnv === 'production';

  // PORT
  const rawPort = trimmedOrUndefined(source.PORT);
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      errors.push(`PORT must be an integer between 1 and 65535 (received "${rawPort}").`);
    } else {
      port = parsed;
    }
  }

  // DATABASE_URL
  const databaseUrl = trimmedOrUndefined(source.DATABASE_URL);
  if (databaseUrl === undefined) {
    errors.push('DATABASE_URL is required (for example: file:./dev.db).');
  }

  // TEAM_CODE — required in production only.
  const teamCode = trimmedOrUndefined(source.TEAM_CODE);
  if (isProduction && teamCode === undefined) {
    errors.push('TEAM_CODE is required in production.');
  }

  // SESSION_SECRET — required in production, >= 32 chars, no fallback (ADR 0005).
  const sessionSecret = trimmedOrUndefined(source.SESSION_SECRET);
  if (isProduction) {
    if (sessionSecret === undefined) {
      errors.push(
        `SESSION_SECRET is required in production and must be at least ${SESSION_SECRET_MIN_LENGTH} characters. There is no default.`,
      );
    } else if (sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
      errors.push(
        `SESSION_SECRET must be at least ${SESSION_SECRET_MIN_LENGTH} characters in production (received ${sessionSecret.length}).`,
      );
    }
  }

  // APP_TIMEZONE — always validated; an unknown zone is always a mistake.
  const appTimezone = trimmedOrUndefined(source.APP_TIMEZONE) ?? DEFAULT_TIMEZONE;
  if (!isValidTimeZone(appTimezone)) {
    errors.push(`APP_TIMEZONE must be a valid IANA time zone (received "${appTimezone}").`);
  }

  if (errors.length > 0 || nodeEnv === undefined || databaseUrl === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      nodeEnv,
      isProduction,
      port,
      databaseUrl,
      teamCode: teamCode ?? null,
      sessionSecret: sessionSecret ?? null,
      appTimezone,
    },
  };
}

/**
 * Boot entry point. On invalid configuration it logs every problem and exits
 * non-zero via `onFatal` (injectable so the exit path itself is testable).
 */
export function loadEnv(
  source: EnvSource = process.env,
  onFatal: (code: number) => never = (code) => process.exit(code),
): AppConfig {
  const result = validateEnv(source);
  if (!result.ok) {
    logger.error('Refusing to start: the environment is not valid.');
    for (const problem of result.errors) {
      logger.error(`  - ${problem}`);
    }
    return onFatal(1);
  }
  return result.config;
}
