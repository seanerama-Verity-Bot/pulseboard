/**
 * The `/api/updates` routes (`contracts/http-api-v1.md`). Stage 3 lands the
 * first of them:
 *
 * | Route | Behaviour |
 * | --- | --- |
 * | `POST /api/updates` | session → text → mood → insert → `201 { update }` |
 *
 * Check order is normative and identical to the session router's: identity
 * first, payload second. A caller without a session is told nothing about what
 * the form would have accepted.
 *
 * The one rule this file exists to make structural: **the author is
 * `req.member.id`**. An `authorId` in the request body is never read — not
 * ignored after being parsed, simply never looked at (`session-cookie-v1` trust
 * rules, criterion A6).
 */

import { Router } from 'express';
import { EDIT_WINDOW_MS, type Update, type UpdateResponse } from '@pulseboard/shared';

import { getMemberById } from '../data/members';
import { createUpdate, type UpdateRow } from '../data/updates';
import { validateMood, validateUpdateText } from '../domain';
import { clearSessionCookie } from '../session/cookie';
import { asyncRoute, HttpError } from './errors';
import { createRequireSession, NOT_AUTHENTICATED_MESSAGE } from './middleware/requireSession';

export type UpdatesRouterOptions = {
  /** `null` outside production when unset. A null secret verifies nothing. */
  sessionSecret: string | null;
  /** `NODE_ENV === 'production'` — selects the `Secure` attribute when clearing. */
  isProduction: boolean;
};

/**
 * The server's verdict for THIS requester, right now (`http-api-v1`): the
 * requester is the author and the edit window has not closed. A UI convenience
 * only — Stage 5 enforces the same rule on the mutation routes themselves,
 * which is where ADR 0007 actually bites.
 */
export function canMutate(row: UpdateRow, requesterId: string, now: number): boolean {
  return row.authorId === requesterId && now - row.createdAt.getTime() < EDIT_WINDOW_MS;
}

/**
 * `UpdateRow` → the wire `Update`. `authorName` is denormalized here and
 * supplied by the server; the client never has to look a member up.
 */
export function toWireUpdate(
  row: UpdateRow,
  authorName: string,
  requesterId: string,
  now: number = Date.now(),
): Update {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName,
    text: row.text,
    mood: row.mood,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
    canMutate: canMutate(row, requesterId, now),
  };
}

function readField(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  return (body as Record<string, unknown>)[key];
}

export function createUpdatesRouter(options: UpdatesRouterOptions): Router {
  const router = Router();
  const requireSession = createRequireSession({
    sessionSecret: options.sessionSecret,
    isProduction: options.isProduction,
  });

  router.post(
    '/updates',
    requireSession,
    asyncRoute(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');

      // 1. The actor. Read from the cookie by `requireSession`, then re-read
      //    from the database so a member deleted since the cookie was issued is
      //    signed out rather than resurrected — and so `authorName` is the
      //    stored name, not the one the payload happens to carry.
      const memberId = req.member?.id;
      const author = memberId === undefined ? null : await getMemberById(memberId);

      if (author === null) {
        clearSessionCookie(res, options.isProduction);
        throw new HttpError(401, 'NOT_AUTHENTICATED', NOT_AUTHENTICATED_MESSAGE);
      }

      // 2. Text, then mood — both from the pure domain functions, which are the
      //    single validation authority Stage 5's edit path reuses. Nothing is
      //    written until both pass, so a rejected post leaves no row (A7).
      const text = validateUpdateText(readField(req.body, 'text'));
      if (!text.ok) {
        throw new HttpError(400, text.code, text.message, text.field);
      }

      const mood = validateMood(readField(req.body, 'mood'));
      if (!mood.ok) {
        throw new HttpError(400, mood.code, mood.message, mood.field);
      }

      // 3. Insert. `author.id` — never `req.body.authorId`, which this handler
      //    has no code path to read.
      const row = await createUpdate({
        authorId: author.id,
        text: text.value,
        mood: mood.value,
      });

      const body: UpdateResponse = {
        update: toWireUpdate(row, author.displayName, author.id),
      };
      res.status(201).json(body);
    }),
  );

  return router;
}
