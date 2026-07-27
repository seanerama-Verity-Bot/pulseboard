import { describe, expect, it } from 'vitest';

import { MAX_UPDATE_LENGTH } from '@pulseboard/shared';

import { countCharacters, validateUpdateText } from '../src/domain/validateUpdateText';

const atLimit = 'a'.repeat(MAX_UPDATE_LENGTH);
const overLimit = 'a'.repeat(MAX_UPDATE_LENGTH + 1);

describe('validateUpdateText — the A7 boundary, character by character', () => {
  /**
   * The whole of criterion A7 in one table: 0 and 1 either side of the empty
   * boundary, 279/280/281 either side of the limit. The pair that matters is
   * 280 accepted and 281 rejected; the rest are there so an off-by-one in
   * *either* direction fails.
   */
  const cases: Array<{ length: number; accepted: boolean; code?: string }> = [
    { length: 0, accepted: false, code: 'TEXT_EMPTY' },
    { length: 1, accepted: true },
    { length: MAX_UPDATE_LENGTH - 1, accepted: true },
    { length: MAX_UPDATE_LENGTH, accepted: true },
    { length: MAX_UPDATE_LENGTH + 1, accepted: false, code: 'TEXT_TOO_LONG' },
  ];

  for (const { length, accepted, code } of cases) {
    it(`${accepted ? 'accepts' : 'rejects'} ${length} characters`, () => {
      const result = validateUpdateText('a'.repeat(length));

      expect(result.ok).toBe(accepted);
      if (!result.ok) {
        expect(result.code).toBe(code);
        expect(result.field).toBe('text');
      }
    });
  }
});

describe('validateUpdateText', () => {
  it('accepts text at exactly the limit and returns it unchanged', () => {
    const result = validateUpdateText(atLimit);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(atLimit);
      expect(countCharacters(result.value)).toBe(MAX_UPDATE_LENGTH);
    }
  });

  it('rejects one character over the limit with TEXT_TOO_LONG (criterion A7)', () => {
    const result = validateUpdateText(overLimit);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TEXT_TOO_LONG');
      expect(result.field).toBe('text');
      expect(result.message).toContain(String(MAX_UPDATE_LENGTH));
    }
  });

  it('rejects an empty string with TEXT_EMPTY', () => {
    const result = validateUpdateText('');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TEXT_EMPTY');
      expect(result.field).toBe('text');
    }
  });

  it('rejects whitespace-only text with TEXT_EMPTY', () => {
    const result = validateUpdateText('   \t\n  ');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TEXT_EMPTY');
    }
  });

  it('trims before measuring, so padding cannot push a valid update over the limit', () => {
    const padded = `   ${atLimit}   `;
    const result = validateUpdateText(padded);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(atLimit);
    }
  });

  it('trims before storing', () => {
    const result = validateUpdateText('  shipping the walking skeleton  ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('shipping the walking skeleton');
    }
  });

  it('counts an astral character as one character, not two UTF-16 units', () => {
    // 279 ASCII + one emoji = 280 code points but 281 UTF-16 code units.
    const withEmoji = `${'a'.repeat(MAX_UPDATE_LENGTH - 1)}🚀`;
    expect(withEmoji.length).toBe(MAX_UPDATE_LENGTH + 1);

    const result = validateUpdateText(withEmoji);
    expect(result.ok).toBe(true);
  });

  /**
   * The trap this guards: `String.length` counts UTF-16 code units, so 280
   * emoji measure 560 and a counter that agreed with the UI would still be
   * rejected by the server. The limit is in code points on both sides.
   */
  it('accepts 280 emoji and rejects 281 — the limit is in code points', () => {
    const atLimit = '🚀'.repeat(MAX_UPDATE_LENGTH);
    const overLimit = '🚀'.repeat(MAX_UPDATE_LENGTH + 1);

    expect(atLimit.length).toBe(MAX_UPDATE_LENGTH * 2);
    expect(countCharacters(atLimit)).toBe(MAX_UPDATE_LENGTH);

    const accepted = validateUpdateText(atLimit);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value).toBe(atLimit);
    }

    const rejected = validateUpdateText(overLimit);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('TEXT_TOO_LONG');
      expect(rejected.field).toBe('text');
      // The count it reports is the code-point count, not the UTF-16 one.
      expect(rejected.message).toContain(String(MAX_UPDATE_LENGTH + 1));
    }
  });

  it('trims leading and trailing whitespace before measuring, in both directions', () => {
    // Padding cannot push a valid update over…
    const paddedAtLimit = `\n\t  ${'a'.repeat(MAX_UPDATE_LENGTH)}  \t\n`;
    expect(validateUpdateText(paddedAtLimit).ok).toBe(true);

    // …and it cannot rescue one that is over on its own.
    const paddedOverLimit = `   ${'a'.repeat(MAX_UPDATE_LENGTH + 1)}   `;
    const rejected = validateUpdateText(paddedOverLimit);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('TEXT_TOO_LONG');
    }
  });

  it('treats a non-string input as empty rather than throwing', () => {
    for (const input of [undefined, null, 42, {}, []]) {
      const result = validateUpdateText(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TEXT_EMPTY');
      }
    }
  });
});
