import { describe, expect, it } from 'vitest';

import { isTeamCodeValid } from '../src/session/teamCode';

const EXPECTED = 'sunrise-42';

/** A NUL byte, built from its code point so this file stays plain text. */
const NUL = String.fromCharCode(0);

describe('isTeamCodeValid', () => {
  it('accepts the configured code', () => {
    expect(isTeamCodeValid(EXPECTED, EXPECTED)).toBe(true);
  });

  it('accepts a code with whitespace around it (a paste, not a wrong code)', () => {
    expect(isTeamCodeValid(`  ${EXPECTED}\n`, EXPECTED)).toBe(true);
  });

  it('rejects a wrong code of the same length', () => {
    expect(isTeamCodeValid('sunrise-43', EXPECTED)).toBe(false);
  });

  it('rejects a different-case code', () => {
    expect(isTeamCodeValid('SUNRISE-42', EXPECTED)).toBe(false);
  });

  it('rejects an empty submission', () => {
    expect(isTeamCodeValid('', EXPECTED)).toBe(false);
    expect(isTeamCodeValid('   ', EXPECTED)).toBe(false);
  });

  it('rejects wrong-length values without throwing (timingSafeEqual would)', () => {
    const oddities = ['s', 'sunrise-42-and-then-some', 'a'.repeat(100_000), NUL, `${NUL}${NUL}`];

    for (const value of oddities) {
      expect(() => isTeamCodeValid(value, EXPECTED)).not.toThrow();
      expect(isTeamCodeValid(value, EXPECTED)).toBe(false);
    }
  });

  it('rejects a prefix and a suffix of the configured code', () => {
    expect(isTeamCodeValid(EXPECTED.slice(0, -1), EXPECTED)).toBe(false);
    expect(isTeamCodeValid(`${EXPECTED}x`, EXPECTED)).toBe(false);
  });

  it('rejects non-string submissions rather than throwing', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(() => isTeamCodeValid(value, EXPECTED)).not.toThrow();
      expect(isTeamCodeValid(value, EXPECTED)).toBe(false);
    }
  });

  it('rejects everything when no code is configured — there is no open mode', () => {
    for (const submitted of ['', 'anything', EXPECTED]) {
      expect(isTeamCodeValid(submitted, null)).toBe(false);
      expect(isTeamCodeValid(submitted, undefined)).toBe(false);
      expect(isTeamCodeValid(submitted, '')).toBe(false);
    }
  });

  it('compares the same number of bytes for a multi-byte code', () => {
    const unicode = 'café-42';

    expect(isTeamCodeValid(unicode, unicode)).toBe(true);
    expect(isTeamCodeValid('cafe-42', unicode)).toBe(false);
  });
});
