import {
  isMood,
  type CreateUpdateRequest,
  type Update,
  type UpdateResponse,
} from '@pulseboard/shared';

import {
  ApiRequestError,
  JSON_HEADERS,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE,
  readJson,
  send,
  toError,
} from './client';

/**
 * The `/api/updates` calls (`contracts/http-api-v1.md`).
 *
 * The request body carries **only** `text` and `mood`. There is deliberately no
 * `authorId` field to send: the author is the session cookie's member, decided
 * by the server (`session-cookie-v1`), and a client that offered one would be
 * writing a field the server is required to ignore.
 */

/**
 * Validates the wire shape before it reaches a view. A response that is not an
 * `Update` is treated as "we could not reach the board" rather than rendered as
 * half an update.
 */
function readUpdate(body: unknown, status: number): Update {
  const update = (body as Partial<UpdateResponse>).update;

  if (
    typeof update !== 'object' ||
    update === null ||
    typeof update.id !== 'string' ||
    typeof update.authorId !== 'string' ||
    typeof update.authorName !== 'string' ||
    typeof update.text !== 'string' ||
    !isMood(update.mood) ||
    typeof update.createdAt !== 'string' ||
    !(update.editedAt === null || typeof update.editedAt === 'string') ||
    typeof update.canMutate !== 'boolean'
  ) {
    throw new ApiRequestError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, status);
  }

  return update;
}

/**
 * Post an update. Rejects with `code: 'TEXT_EMPTY'`, `'TEXT_TOO_LONG'`,
 * `'INVALID_MOOD'` or `'NOT_AUTHENTICATED'` so the composer can show its own
 * message for each. The server's validation is the authority; the composer's
 * counter is a courtesy that can be stale.
 */
export async function createUpdate(input: CreateUpdateRequest): Promise<Update> {
  const response = await send('/api/updates', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text: input.text, mood: input.mood }),
  });

  if (!response.ok) {
    throw await toError(response);
  }

  return readUpdate(await readJson(response), response.status);
}
