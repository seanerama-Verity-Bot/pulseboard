import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PORT,
  DEFAULT_TIMEZONE,
  SESSION_SECRET_MIN_LENGTH,
  loadEnv,
  validateEnv,
  type EnvSource,
} from '../src/env';

const LONG_SECRET = 'x'.repeat(SESSION_SECRET_MIN_LENGTH);

function productionEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:/srv/pulseboard/data/pulseboard.db',
    TEAM_CODE: 'sunrise-42',
    SESSION_SECRET: LONG_SECRET,
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('applies the documented defaults in development', () => {
    const result = validateEnv({ DATABASE_URL: 'file:./dev.db' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.nodeEnv).toBe('development');
      expect(result.config.isProduction).toBe(false);
      expect(result.config.port).toBe(DEFAULT_PORT);
      expect(result.config.appTimezone).toBe(DEFAULT_TIMEZONE);
      expect(result.config.sessionSecret).toBeNull();
      expect(result.config.teamCode).toBeNull();
    }
  });

  it('requires DATABASE_URL in every environment', () => {
    const result = validateEnv({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('DATABASE_URL');
    }
  });

  it('accepts a valid production environment', () => {
    const result = validateEnv(productionEnv({ APP_TIMEZONE: 'Europe/London', PORT: '3001' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.isProduction).toBe(true);
      expect(result.config.sessionSecret).toBe(LONG_SECRET);
      expect(result.config.appTimezone).toBe('Europe/London');
    }
  });

  it('rejects a SESSION_SECRET shorter than 32 characters in production', () => {
    const short = 'x'.repeat(SESSION_SECRET_MIN_LENGTH - 1);
    const result = validateEnv(productionEnv({ SESSION_SECRET: short }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('SESSION_SECRET');
    }
  });

  it('rejects a missing SESSION_SECRET in production — there is no fallback (ADR 0005)', () => {
    const result = validateEnv(productionEnv({ SESSION_SECRET: undefined }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('SESSION_SECRET');
    }
  });

  it('rejects a missing TEAM_CODE in production', () => {
    const result = validateEnv(productionEnv({ TEAM_CODE: '   ' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('TEAM_CODE');
    }
  });

  it('tolerates a short SESSION_SECRET outside production', () => {
    const result = validateEnv({ DATABASE_URL: 'file:./dev.db', SESSION_SECRET: 'short' });

    expect(result.ok).toBe(true);
  });

  it('rejects an invalid APP_TIMEZONE', () => {
    const result = validateEnv(productionEnv({ APP_TIMEZONE: 'Mars/Olympus_Mons' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('APP_TIMEZONE');
    }
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    for (const port of ['not-a-port', '0', '70000', '3001.5']) {
      const result = validateEnv({ DATABASE_URL: 'file:./dev.db', PORT: port });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(' ')).toContain('PORT');
      }
    }
  });

  it('rejects an unrecognised NODE_ENV rather than silently downgrading it', () => {
    const result = validateEnv({ NODE_ENV: 'staging', DATABASE_URL: 'file:./dev.db' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('NODE_ENV');
    }
  });

  it('reports every problem at once instead of stopping at the first', () => {
    const result = validateEnv({ NODE_ENV: 'production', APP_TIMEZONE: 'Nowhere/Nothing' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('loadEnv', () => {
  it('exits non-zero when the environment is invalid', () => {
    const fatal = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as unknown as (code: number) => never;

    expect(() => loadEnv(productionEnv({ SESSION_SECRET: 'too-short' }), fatal)).toThrow('exit:1');
    expect(fatal).toHaveBeenCalledWith(1);
  });

  it('returns the config and never exits when the environment is valid', () => {
    const fatal = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as unknown as (code: number) => never;

    const config = loadEnv(productionEnv(), fatal);

    expect(config.isProduction).toBe(true);
    expect(fatal).not.toHaveBeenCalled();
  });
});
