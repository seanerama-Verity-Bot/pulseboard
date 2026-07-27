import { type CreateSessionRequest, type Member, type SessionResponse } from '@pulseboard/shared';

import {
  ACCEPT_JSON,
  ApiRequestError,
  JSON_HEADERS,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE,
  readJson,
  send,
  toError,
} from './client';

/**
 * The `/api/session` calls (`contracts/http-api-v1.md`). The transport, the
 * error envelope and the {@link ApiRequestError} type all live in `./client`,
 * shared with every other endpoint.
 */

async function readMember(response: Response): Promise<Member> {
  const body = await readJson(response);

  const member = (body as Partial<SessionResponse>).member;
  if (
    typeof member !== 'object' ||
    member === null ||
    typeof member.id !== 'string' ||
    typeof member.displayName !== 'string' ||
    typeof member.joinedAt !== 'string'
  ) {
    throw new ApiRequestError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, response.status);
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
    headers: ACCEPT_JSON,
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
    headers: ACCEPT_JSON,
  });

  if (!response.ok) {
    throw await toError(response);
  }
}
