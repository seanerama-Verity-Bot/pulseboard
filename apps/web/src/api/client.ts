/**
 * The one HTTP seam every `/api` call goes through (`contracts/http-api-v1.md`).
 *
 * Same-origin in production and, thanks to the Vite proxy, in dev too — so no
 * base URL is ever configured on the client and the session cookie behaves
 * identically in both.
 *
 * Every failure arrives as an {@link ApiRequestError} carrying the server's
 * stable `code`, so a view can tell "wrong team code" from "too long" from "the
 * board is unreachable" without parsing a message. Views map the code to their
 * own copy; the server's `message` is a safe fallback, never a status line and
 * never a stack trace.
 */

import { type ApiError } from '@pulseboard/shared';

/**
 * The code used when there is no `http-api-v1` envelope to read at all: the
 * request never left, the connection dropped, or the answer was not the shape
 * we expect. Never a real server code, so a `switch` cannot confuse the two.
 */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** Human, polite, and free of status codes and stack traces. */
export const NETWORK_ERROR_MESSAGE =
  'We could not reach the board just now. Please check your connection and try again.';

export class ApiRequestError extends Error {
  /** An `ApiErrorCode`, or {@link NETWORK_ERROR_CODE}. */
  readonly code: string;
  /** The HTTP status, or `null` when the request never got an answer. */
  readonly status: number | null;
  /** Present on validation failures, e.g. `"displayName"` or `"text"`. */
  readonly field: string | undefined;

  constructor(code: string, message: string, status: number | null, field?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

export const ACCEPT_JSON = { Accept: 'application/json' };

/**
 * `credentials: 'same-origin'` is what makes the session cookie flow. A network
 * failure becomes an {@link ApiRequestError} rather than a raw `TypeError`, so
 * callers have exactly one error type to handle.
 */
export async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiRequestError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, null);
  }
}

/** Turns a non-OK response into an error, preferring the server's own envelope. */
export async function toError(response: Response): Promise<ApiRequestError> {
  try {
    const body: unknown = await response.json();
    const envelope = (body as Partial<ApiError>).error;

    if (
      typeof envelope === 'object' &&
      envelope !== null &&
      typeof envelope.code === 'string' &&
      typeof envelope.message === 'string'
    ) {
      return new ApiRequestError(
        envelope.code,
        envelope.message,
        response.status,
        typeof envelope.field === 'string' ? envelope.field : undefined,
      );
    }
  } catch {
    // No JSON body, or not the envelope: fall through to the generic message.
  }

  return new ApiRequestError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
}

/** Parses a success body, treating a malformed one as unreachable rather than crashing. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
  }
}
