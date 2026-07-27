import { describe, expect, it } from 'vitest';

import { MAX_UPDATE_LENGTH } from '@pulseboard/shared';

import { countCharacters, validateUpdateText } from '../src/domain/validateUpdateText';

const atLimit = 'a'.repeat(MAX_UPDATE_LENGTH);
const overLimit = 'a'.repeat(MAX_UPDATE_LENGTH + 1);

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
