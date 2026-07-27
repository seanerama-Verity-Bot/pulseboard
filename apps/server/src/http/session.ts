/**
 * The `/api/session` routes — the app's only door (ADR 0005,
 * `contracts/http-api-v1.md`).
 *
 * | Route | Behaviour |
 * | --- | --- |
 * | `POST /api/session`   | code → display name → find-or-create → cookie → `201 { member }` |
 * | `GET /api/session`    | `200 { member }` signed in, else `401 NOT_AUTHENTICATED` |
 * | `DELETE /api/session` | `204`, clears the cookie, idempotent, no auth needed |
 *
 * Check order on `POST` is normative: the team code is compared **before** the
 * display name is even looked at, so a stranger with the wrong code learns
 * nothing about what the form would have accepted.
 */

import { Router } from 'express';
import { type Member, type SessionResponse } from '@pulseboard/shared';

import { findOrCreateMember, getMemberById, type MemberRow } from '../data/members';
import { validateDisplayName } from '../domain';
import { clearSessionCookie, setSessionCookie, sign } from '../session/cookie';
import { isTeamCodeValid } from '../session/teamCode';
import { asyncRoute, HttpError } from './errors';
import { createRequireSession, NOT_AUTHENTICATED_MESSAGE } from './middleware/requireSession';

export type SessionRouterOptions = {
  /** `null` outside production when `TEAM_CODE` is unset. */
  teamCode: string | null;
  /** `null` outside production when `SESSION_SECRET` is unset. Never defaulted. */
  sessionSecret: string | null;
  /** `NODE_ENV === 'production'` — selects the cookie's `Secure` attribute. */
  isProduction: boolean;
};

/**
 * The same rejection whether the code is wrong, empty, malformed, or the server
 * has no code configured at all. It says nothing about the expected value.
 */
const INVALID_TEAM_CODE_MESSAGE =
  'That team code did not match. Check it with a teammate and try again.';

function toWireMember(row: MemberRow): Member {
  return {
    id: row.id,
    displayName: row.displayName,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function readField(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  return (body as Record<string, unknown>)[key];
}

export function createSessionRouter(options: SessionRouterOptions): Router {
  const router = Router();
  const requireSession = createRequireSession({
    sessionSecret: options.sessionSecret,
    isProduction: options.isProduction,
  });

  /**
   * Join. Nothing here is cacheable, and no branch before the cookie is set can
   * leave a `Set-Cookie` header behind.
   */
  router.post(
    '/session',
    asyncRoute(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');

      // 1. Team code, timing-safe, first.
      //
      //    `sessionSecret === null` is the non-production "unset" case. An
      //    unsigned cookie would be a forged-identity bug (ADR 0005), so a
      //    server that cannot sign refuses to join — deterministically, and
      //    with exactly the same response a wrong code gets.
      const sessionSecret = options.sessionSecret;
      if (
        sessionSecret === null ||
        !isTeamCodeValid(readField(req.body, 'teamCode'), options.teamCode)
      ) {
        throw new HttpError(401, 'INVALID_TEAM_CODE', INVALID_TEAM_CODE_MESSAGE);
      }

      // 2. Display name.
      const name = validateDisplayName(readField(req.body, 'displayName'));
      if (!name.ok) {
        throw new HttpError(400, name.code, name.message, name.field);
      }

      // 3. Find-or-create: a returning teammate re-joins as themselves.
      const row = await findOrCreateMember(name.value);

      // 4. The only place in the system that issues a cookie.
      const cookie = sign(
        { memberId: row.id, displayName: row.displayName, issuedAt: Date.now() },
        sessionSecret,
      );
      setSessionCookie(res, cookie, options.isProduction);

      const body: SessionResponse = { member: toWireMember(row) };
      res.status(201).json(body);
    }),
  );

  /**
   * Who am I? The client treats the `401` as a normal signal to show the join
   * page, not as an error to render.
   *
   * The identity comes from the cookie and is then re-read from the database, so
   * a member deleted since the cookie was issued is signed out rather than
   * resurrected from the payload.
   */
  router.get(
    '/session',
    requireSession,
    asyncRoute(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');

      const memberId = req.member?.id;
      const row = memberId === undefined ? null : await getMemberById(memberId);

      if (row === null) {
        clearSessionCookie(res, options.isProduction);
        throw new HttpError(401, 'NOT_AUTHENTICATED', NOT_AUTHENTICATED_MESSAGE);
      }

      const body: SessionResponse = { member: toWireMember(row) };
      res.status(200).json(body);
    }),
  );

  /**
   * Leave. Idempotent and deliberately unauthenticated: someone holding a
   * cookie the server no longer accepts must still be able to get rid of it.
   */
  router.delete('/session', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    clearSessionCookie(res, options.isProduction);
    res.status(204).end();
  });

  return router;
}
