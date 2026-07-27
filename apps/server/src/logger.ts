/**
 * The one place the server writes to stdout/stderr. Deliberately tiny: journald
 * (ADR 0004) collects whatever we print, and nothing here is on a hot path.
 *
 * Stack traces are logged here and *never* placed in an HTTP response body.
 */

function stamp(): string {
  return new Date().toISOString();
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.stack ?? `${cause.name}: ${cause.message}`;
  }
  if (cause === undefined) {
    return '';
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, cause?: unknown): void;
};

export const logger: Logger = {
  info(message) {
    console.log(`${stamp()} INFO  ${message}`);
  },
  warn(message) {
    console.warn(`${stamp()} WARN  ${message}`);
  },
  error(message, cause) {
    const detail = describe(cause);
    console.error(`${stamp()} ERROR ${message}${detail === '' ? '' : `\n${detail}`}`);
  },
};
