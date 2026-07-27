/**
 * `contracts/session-cookie-v1.md` implemented in full — the sole producer and
 * sole verifier of caller identity in this system (ADR 0005).
 *
 * Deliberately small enough to read end to end. There is no session table, no
 * bearer token and no JWT library: the whole trust story is `sign`, `verify` and
 * the attribute table below.
 */

import crypto from 'node:crypto';

import { type CookieOptions, type Response } from 'express';
import { SESSION_COOKIE_NAME } from '@pulseboard/shared';

/** `Max-Age` from the contract: 30 days. */
export const SESSION_MAX_AGE_SECONDS = 2_592_000;

/** The same window in milliseconds, used for the `issuedAt` freshness check. */
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export type SessionPayload = {
  /** cuid — the `Member.id`. */
  memberId: string;
  /** Denormalized so a display does not need a database read. */
  displayName: string;
  /** Epoch milliseconds. */
  issuedAt: number;
};

const SEGMENT_SEPARATOR = '.';

function hmacSegment(payloadSegment: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(Buffer.from(payloadSegment, 'utf8'))
    .digest('base64url');
}

/**
 * `base64url(JSON).base64url(HMAC-SHA256)`.
 *
 * The HMAC covers the **encoded payload segment exactly as transmitted**, which
 * is what lets `verify` avoid re-serializing JSON (a signature that depended on
 * key order would be a forgery surface, not a bug).
 */
export function sign(payload: SessionPayload, secret: string): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadSegment}${SEGMENT_SEPARATOR}${hmacSegment(payloadSegment, secret)}`;
}

function isWellFormedPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.memberId === 'string' &&
    candidate.memberId.length > 0 &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.issuedAt === 'number' &&
    Number.isFinite(candidate.issuedAt)
  );
}

/**
 * The contract's verification order, and nothing else:
 *
 * 1. exactly two non-empty `.`-separated segments,
 * 2. timing-safe HMAC comparison (length pre-check first, so odd input cannot
 *    make `timingSafeEqual` throw),
 * 3. JSON parse and shape check,
 * 4. `issuedAt` not older than 30 days.
 *
 * Every failure returns `null`. It never throws, and the caller cannot tell
 * which check failed — a missing cookie, a tampered payload and a forged
 * signature are one indistinguishable outcome.
 *
 * Unknown payload keys are ignored, so a future additive field is safe to read
 * with an older build.
 */
export function verify(
  cookieValue: string | null | undefined,
  secret: string | null | undefined,
  now: number = Date.now(),
): SessionPayload | null {
  try {
    if (typeof cookieValue !== 'string' || typeof secret !== 'string' || secret.length === 0) {
      return null;
    }

    // 1. Shape: exactly two segments, both non-empty.
    const segments = cookieValue.split(SEGMENT_SEPARATOR);
    if (segments.length !== 2) {
      return null;
    }
    const [payloadSegment, signatureSegment] = segments;
    if (
      payloadSegment === undefined ||
      signatureSegment === undefined ||
      payloadSegment.length === 0 ||
      signatureSegment.length === 0
    ) {
      return null;
    }

    // 2. Signature, timing-safe, over the segment as transmitted.
    const expected = Buffer.from(hmacSegment(payloadSegment, secret), 'utf8');
    const actual = Buffer.from(signatureSegment, 'utf8');
    if (expected.length !== actual.length) {
      return null;
    }
    if (!crypto.timingSafeEqual(expected, actual)) {
      return null;
    }

    // 3. Payload: parse and shape.
    const json = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!isWellFormedPayload(parsed)) {
      return null;
    }

    // 4. Freshness. The cookie's own Max-Age is client-controlled, so the
    //    server does not trust it on its own.
    if (now - parsed.issuedAt > SESSION_MAX_AGE_MS) {
      return null;
    }

    return {
      memberId: parsed.memberId,
      displayName: parsed.displayName,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    // Malformed base64, malformed JSON, anything at all: one outcome.
    return null;
  }
}

/**
 * The contract's attribute table.
 *
 * `secure` is on **only** in production. `isProduction` is `NODE_ENV ===
 * 'production'` as decided once in `src/env.ts`; setting `Secure` in
 * development breaks local login silently over plain HTTP (ADR 0005), which is
 * why both directions are asserted by test.
 */
export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    // Express takes `maxAge` in milliseconds and emits `Max-Age` in seconds.
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/** Issued only by `POST /api/session`, and only after the team code passes. */
export function setSessionCookie(res: Response, value: string, isProduction: boolean): void {
  res.cookie(SESSION_COOKIE_NAME, value, sessionCookieOptions(isProduction));
}

/**
 * Clears a stale or rejected cookie. `maxAge` is dropped so the browser sees an
 * expiry rather than a fresh 30-day lifetime; every other attribute has to match
 * the issued cookie or the browser keeps the old one.
 */
export function clearSessionCookie(res: Response, isProduction: boolean): void {
  const { maxAge: _maxAge, ...attributes } = sessionCookieOptions(isProduction);
  res.clearCookie(SESSION_COOKIE_NAME, attributes);
}
