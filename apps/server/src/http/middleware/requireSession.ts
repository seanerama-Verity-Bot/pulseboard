/**
 * The one gate every authenticated route sits behind (`session-cookie-v1`,
 * ADR 0005).
 *
 * The cookie is the ONLY identity input. There is no header, query-parameter or
 * body override, in any environment, including tests — which is the structural
 * half of criterion A6.
 */

import { type RequestHandler } from 'express';
import { SESSION_COOKIE_NAME } from '@pulseboard/shared';

import { clearSessionCookie, verify } from '../../session/cookie';
import { readCookie } from '../cookies';
import { HttpError } from '../errors';

export type SessionMember = {
  id: string;
  displayName: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireSession`, derived from the signed cookie and nothing else. */
      member?: SessionMember;
    }
  }
}

export type RequireSessionOptions = {
  /** `null` outside production when unset; a null secret verifies nothing. */
  sessionSecret: string | null;
  /** `NODE_ENV === 'production'` — selects the `Secure` attribute when clearing. */
  isProduction: boolean;
};

export const NOT_AUTHENTICATED_MESSAGE = 'Please join the board to continue.';

/**
 * Rejects a missing, expired, tampered or forged cookie with
 * `401 NOT_AUTHENTICATED` in the `http-api-v1` envelope, and clears the stale
 * cookie on the way out so the browser stops sending it. Never a 500, and never
 * a hint about which check failed.
 */
export function createRequireSession(options: RequireSessionOptions): RequestHandler {
  return (req, res, next) => {
    const presented = readCookie(req, SESSION_COOKIE_NAME);
    const payload = verify(presented, options.sessionSecret);

    if (payload === null) {
      if (presented !== undefined) {
        clearSessionCookie(res, options.isProduction);
      }
      next(new HttpError(401, 'NOT_AUTHENTICATED', NOT_AUTHENTICATED_MESSAGE));
      return;
    }

    req.member = { id: payload.memberId, displayName: payload.displayName };
    next();
  };
}
