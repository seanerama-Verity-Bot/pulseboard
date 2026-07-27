import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SESSION_MAX_AGE_MS,
  sessionCookieOptions,
  sign,
  verify,
  type SessionPayload,
} from '../src/session/cookie';

const SECRET = 'test-secret-'.repeat(4);
const OTHER_SECRET = 'other-secret-'.repeat(4);

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    memberId: 'clx0000000000000000000000',
    displayName: 'Ada Lovelace',
    issuedAt: Date.now(),
    ...overrides,
  };
}

function segments(cookie: string): [string, string] {
  const parts = cookie.split('.');
  return [parts[0] ?? '', parts[1] ?? ''];
}

describe('sign', () => {
  it('produces exactly two base64url segments', () => {
    const cookie = sign(payload(), SECRET);
    const parts = cookie.split('.');

    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('signs the encoded payload segment as transmitted, not a re-serialization', () => {
    const [payloadSegment, signature] = segments(sign(payload(), SECRET));

    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(Buffer.from(payloadSegment, 'utf8'))
      .digest('base64url');

    expect(signature).toBe(expected);
  });

  it('never puts the secret in the cookie', () => {
    expect(sign(payload(), SECRET)).not.toContain(SECRET);
  });
});

describe('verify', () => {
  it('round-trips a freshly signed payload', () => {
    const original = payload();
    const result = verify(sign(original, SECRET), SECRET);

    expect(result).toEqual(original);
  });

  it('ignores unknown payload keys (forward compatible)', () => {
    const extended = { ...payload(), somethingNew: 'from a later stage' };
    const encoded = Buffer.from(JSON.stringify(extended), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(Buffer.from(encoded, 'utf8'))
      .digest('base64url');

    const result = verify(`${encoded}.${signature}`, SECRET);

    expect(result).not.toBeNull();
    expect(result?.memberId).toBe(extended.memberId);
    expect(result).not.toHaveProperty('somethingNew');
  });

  it('rejects a tampered payload (the forged-identity case, criterion A6)', () => {
    const cookie = sign(payload({ memberId: 'member-a' }), SECRET);
    const [, signature] = segments(cookie);

    const forged = Buffer.from(
      JSON.stringify(payload({ memberId: 'member-b', displayName: 'Impostor' })),
      'utf8',
    ).toString('base64url');

    expect(verify(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const [payloadSegment, signature] = segments(sign(payload(), SECRET));
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

    expect(verify(`${payloadSegment}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects a signature made with a different secret (rotation revokes everyone)', () => {
    expect(verify(sign(payload(), OTHER_SECRET), SECRET)).toBeNull();
  });

  it('rejects an unsigned payload smuggled in with an empty signature', () => {
    const [payloadSegment] = segments(sign(payload(), SECRET));

    expect(verify(`${payloadSegment}.`, SECRET)).toBeNull();
    expect(verify(payloadSegment, SECRET)).toBeNull();
  });

  it('rejects truncated, one-segment, three-segment, garbage and empty values', () => {
    const cookie = sign(payload(), SECRET);
    const [payloadSegment, signature] = segments(cookie);

    const rejected = [
      '',
      '.',
      '..',
      'not-a-cookie',
      payloadSegment,
      signature,
      cookie.slice(0, Math.floor(cookie.length / 2)),
      `${cookie}.extra`,
      `${payloadSegment}.${signature}.${signature}`,
      `${payloadSegment}.${signature.slice(0, -3)}`,
      `!!!.???`,
      Buffer.from('{"memberId":"x"}', 'utf8').toString('base64url'),
    ];

    for (const value of rejected) {
      expect(verify(value, SECRET), `expected ${JSON.stringify(value)} to be rejected`).toBeNull();
    }
  });

  it('rejects a missing cookie and a missing secret without throwing', () => {
    expect(verify(undefined, SECRET)).toBeNull();
    expect(verify(null, SECRET)).toBeNull();
    expect(verify(sign(payload(), SECRET), null)).toBeNull();
    expect(verify(sign(payload(), SECRET), '')).toBeNull();
    expect(verify(undefined, null)).toBeNull();
  });

  it('rejects a validly signed cookie whose payload is not a session payload', () => {
    for (const body of ['null', '42', '"a string"', '[]', '{}', '{"memberId":""}', 'not json']) {
      const encoded = Buffer.from(body, 'utf8').toString('base64url');
      const signature = crypto
        .createHmac('sha256', SECRET)
        .update(Buffer.from(encoded, 'utf8'))
        .digest('base64url');

      expect(verify(`${encoded}.${signature}`, SECRET)).toBeNull();
    }
  });

  it('rejects an issuedAt older than 30 days, and accepts one just inside it', () => {
    const now = Date.now();

    const stale = sign(payload({ issuedAt: now - SESSION_MAX_AGE_MS - 1 }), SECRET);
    expect(verify(stale, SECRET, now)).toBeNull();

    const fresh = sign(payload({ issuedAt: now - SESSION_MAX_AGE_MS + 1000 }), SECRET);
    expect(verify(fresh, SECRET, now)).not.toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    // Built from its code point so no control character has to be typed into
    // this file — a raw NUL byte would make git treat the source as binary.
    const nul = String.fromCharCode(0);

    const nasty = [
      '',
      '.',
      'a.b',
      '%%%.%%%',
      `${'a'.repeat(10_000)}.${'b'.repeat(10_000)}`,
      `${nul}.${nul}`,
      ' . ',
      'ᚠᛇᚻ.ᚠᛇᚻ',
    ];

    for (const value of nasty) {
      expect(() => verify(value, SECRET)).not.toThrow();
      expect(verify(value, SECRET)).toBeNull();
    }
  });
});

describe('cookie attributes', () => {
  it('is HttpOnly, SameSite=Lax, Path=/ and 30 days in every environment', () => {
    for (const isProduction of [true, false]) {
      const options = sessionCookieOptions(isProduction);

      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.path).toBe('/');
      expect(options.maxAge).toBe(SESSION_MAX_AGE_MS);
    }
  });

  it('sets Secure in production and not in development (ADR 0005)', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
