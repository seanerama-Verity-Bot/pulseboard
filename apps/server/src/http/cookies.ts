/**
 * A `Cookie:` header reader, twelve lines instead of a dependency.
 *
 * `cookie-parser` exists to do this, plus signed-cookie and JSON-cookie support
 * this app deliberately does not use: signing is `session/cookie.ts`'s job and
 * is the one thing criterion A6 rests on (ADR 0005, alternative 2 — the same
 * reasoning that rejected a JWT library). Writing cookies needs no helper at
 * all; `res.cookie` is part of Express.
 */

import { type Request } from 'express';

/**
 * Returns the first value for `name`, or `undefined`. Never throws:
 * `decodeURIComponent` rejects a malformed percent-escape, and a malformed
 * cookie is simply an absent one.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) {
    return undefined;
  }

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (pair.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return undefined;
}
