/**
 * The `http-api-v1` error envelope and the global Express error handler.
 *
 * Every error, at every status, leaves this process as
 * `{ error: { code, message, field? } }`. Stack traces are logged, never sent.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { type ApiError, type ApiErrorCode } from '@pulseboard/shared';

import { logger } from '../logger';

/** An error that already knows its wire shape. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly field: string | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function toApiError(code: ApiErrorCode, message: string, field?: string): ApiError {
  return field === undefined ? { error: { code, message } } : { error: { code, message, field } };
}

/**
 * Terminal 404. Mounted for unmatched `/api/*` (which must never receive
 * `index.html` — ADR 0002) and as the last resort for unmatched non-GET
 * requests.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'That endpoint does not exist.'));
};

const GENERIC_MESSAGE = 'Something went wrong on our end. Please try again.';

/**
 * The global error handler. Must be registered last.
 *
 * Known `HttpError`s keep their status, code and field. Anything else — an
 * unhandled throw, a rejected promise handed to `next`, a framework error —
 * becomes a 500 `INTERNAL_ERROR` with a generic message. The original error,
 * stack included, goes to the log only.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    // Express's default handler is the only thing that can safely abort a
    // response whose headers are already on the wire.
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json(toApiError(error.code, error.message, error.field));
    return;
  }

  logger.error(`Unhandled error while serving ${req.method} ${req.originalUrl}`, error);
  res.status(500).json(toApiError('INTERNAL_ERROR', GENERIC_MESSAGE));
};
