import {
  type ApiError,
  type CreateSessionRequest,
  type Member,
  type SessionResponse,
} from '@pulseboard/shared';

/**
 * The `/api/session` calls (`contracts/http-api-v1.md`). Same-origin in
 * production and, thanks to the Vite proxy, in dev too — so no base URL is ever
 * configured on the client and the session cookie behaves identically in both.
 *
 * Every failure arrives as a {@link SessionApiError} carrying the server's
 * stable `code`, so a view can tell "wrong team code" from "the board is
 * unreachable" without parsing a message.
 */

/**
 * The code used when there is no `http-api-v1` envelope to read at all: the
 * request never left, the connection dropped, or the answer was not the shape
 * we expect. Never a real server code, so a `switch` cannot confuse the two.
 */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** Human, polite, and free of status codes and stack traces. */
export const NETWORK_ERROR_MESSAGE =
  'We could not reach the board just now. Please check your connection and try again.';

export class SessionApiError extends Error {
  /** An `ApiErrorCode`, or {@link NETWORK_ERROR_CODE}. */
  readonly code: string;
  /** The HTTP status, or `null` when the request never got an answer. */
  readonly status: number | null;
  /** Present on validation failures, e.g. `"displayName"`. */
  readonly field: string | undefined;

  constructor(code: string, message: string, status: number | null, field?: string) {
    super(message);
    this.name = 'SessionApiError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/**
 * `credentials: 'same-origin'` is what makes the session cookie flow. A network
 * failure becomes a {@link SessionApiError} rather than a raw `TypeError`, so
 * callers have exactly one error type to handle.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new SessionApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, null);
  }
}

/** Turns a non-OK response into an error, preferring the server's own envelope. */
async function toError(response: Response): Promise<SessionApiError> {
  try {
    const body: unknown = await response.json();
    const envelope = (body as Partial<ApiError>).error;

    if (
      typeof envelope === 'object' &&
      envelope !== null &&
      typeof envelope.code === 'string' &&
      typeof envelope.message === 'string'
    ) {
      return new SessionApiError(
        envelope.code,
        envelope.message,
        response.status,
        typeof envelope.field === 'string' ? envelope.field : undefined,
      );
    }
  } catch {
    // No JSON body, or not the envelope: fall through to the generic message.
  }

  return new SessionApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
}

async function readMember(response: Response): Promise<Member> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SessionApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
  }

  const member = (body as Partial<SessionResponse>).member;
  if (
    typeof member !== 'object' ||
    member === null ||
    typeof member.id !== 'string' ||
    typeof member.displayName !== 'string' ||
    typeof member.joinedAt !== 'string'
  ) {
    throw new SessionApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
  }

  return member;
}

/**
 * The session probe run on app load. A `401` is a **normal signal** — nobody is
 * signed in yet — and is reported as `null`, not as an error to render.
 */
export async function fetchSession(signal?: AbortSignal): Promise<Member | null> {
  const response = await send('/api/session', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await toError(response);
  }

  return readMember(response);
}

/**
 * Join. Rejects with `code: 'INVALID_TEAM_CODE'` or `'INVALID_DISPLAY_NAME'`
 * so the view can put the message next to the right field.
 */
export async function createSession(input: CreateSessionRequest): Promise<Member> {
  const response = await send('/api/session', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await toError(response);
  }

  return readMember(response);
}

/** Sign out. Idempotent on the server, so a second call is not an error. */
export async function deleteSession(): Promise<void> {
  const response = await send('/api/session', {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw await toError(response);
  }
}
