/**
 * The team code gate (ADR 0005). It is the only thing standing between a
 * stranger and a session cookie, so the comparison is timing-safe and the
 * expected value never leaves this module — it is never logged, never echoed,
 * and never appears in a response body.
 */

import crypto from 'node:crypto';

/**
 * `crypto.timingSafeEqual` throws on unequal-length buffers, so the length
 * pre-check comes first: odd input is rejected, never a 500.
 *
 * A missing or empty `expected` (the non-production case where `TEAM_CODE` is
 * unset) rejects everything. There is no "no code configured means anyone may
 * join" mode, in any environment.
 *
 * The submitted code is trimmed, because a trailing space pasted from a chat
 * message is a typo rather than a wrong code. The expected value is used as
 * configured.
 */
export function isTeamCodeValid(provided: unknown, expected: string | null | undefined): boolean {
  if (typeof expected !== 'string' || expected.length === 0) {
    return false;
  }
  if (typeof provided !== 'string') {
    return false;
  }

  const submitted = Buffer.from(provided.trim(), 'utf8');
  const configured = Buffer.from(expected, 'utf8');

  if (submitted.length !== configured.length) {
    return false;
  }

  return crypto.timingSafeEqual(submitted, configured);
}
