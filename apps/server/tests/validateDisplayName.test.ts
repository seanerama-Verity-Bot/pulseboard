import { describe, expect, it } from 'vitest';

import { MAX_DISPLAY_NAME_LENGTH } from '@pulseboard/shared';

import { validateDisplayName } from '../src/domain/validateDisplayName';

const atLimit = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH);
const overLimit = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);

/**
 * Control characters are built from code points rather than typed as escapes,
 * so this file stays readable and no invisible byte can drift in a diff.
 * NUL, TAB, LF, VT, CR, US and DEL.
 */
const CONTROL_CODE_POINTS = [0x00, 0x09, 0x0a, 0x0b, 0x0d, 0x1f, 0x7f];
const character = (code: number): string => String.fromCharCode(code);

describe('validateDisplayName', () => {
  it('accepts a single character', () => {
    const result = validateDisplayName('A');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('A');
    }
  });

  it('accepts exactly 40 characters', () => {
    const result = validateDisplayName(atLimit);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(atLimit);
    }
  });

  it('rejects 41 characters with INVALID_DISPLAY_NAME on the displayName field', () => {
    const result = validateDisplayName(overLimit);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_DISPLAY_NAME');
      expect(result.field).toBe('displayName');
      expect(result.message).toContain(String(MAX_DISPLAY_NAME_LENGTH));
    }
  });

  it('rejects an empty string', () => {
    const result = validateDisplayName('');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_DISPLAY_NAME');
      expect(result.field).toBe('displayName');
    }
  });

  it('rejects a whitespace-only name', () => {
    const whitespaceOnly = [
      '   ',
      character(0x09),
      character(0x0a),
      `  ${character(0x09)}${character(0x0a)}  `,
      character(0x0d) + character(0x0a),
    ];

    for (const value of whitespaceOnly) {
      const result = validateDisplayName(value);
      expect(result.ok, `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
    }
  });

  it('trims leading and trailing whitespace before storing and measuring', () => {
    const result = validateDisplayName('   Ada Lovelace   ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Ada Lovelace');
    }

    // Padding cannot push a name that fits over the limit.
    const padded = validateDisplayName(`   ${atLimit}   `);
    expect(padded.ok).toBe(true);
  });

  it('rejects control characters inside the name', () => {
    for (const code of CONTROL_CODE_POINTS) {
      const value = `Ada${character(code)}Lovelace`;
      const result = validateDisplayName(value);

      expect(result.ok, `expected code point ${code} to be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_DISPLAY_NAME');
        expect(result.field).toBe('displayName');
      }
    }
  });

  it('keeps inner spaces and accented letters', () => {
    const result = validateDisplayName('Renée  van der Berg');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Renée  van der Berg');
    }
  });

  it('counts an astral character as one character, not two UTF-16 units', () => {
    const withEmoji = `${'a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1)}🚀`;
    expect(withEmoji.length).toBe(MAX_DISPLAY_NAME_LENGTH + 1);

    expect(validateDisplayName(withEmoji).ok).toBe(true);
  });

  it('treats a non-string input as missing rather than throwing', () => {
    for (const input of [undefined, null, 42, {}, [], true]) {
      const result = validateDisplayName(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_DISPLAY_NAME');
      }
    }
  });
});
