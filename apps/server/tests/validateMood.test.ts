import { describe, expect, it } from 'vitest';

import { MOODS } from '@pulseboard/shared';

import { validateMood } from '../src/domain/validateMood';

describe('validateMood', () => {
  it('accepts each of the four moods and returns it unchanged', () => {
    expect(MOODS).toEqual(['focused', 'cruising', 'blocked', 'away']);

    for (const mood of MOODS) {
      const result = validateMood(mood);

      expect(result.ok, mood).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(mood);
      }
    }
  });

  it('rejects a wrong-case mood — the union is exact, not case-folded', () => {
    const result = validateMood('FOCUSED');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_MOOD');
      expect(result.field).toBe('mood');
    }
  });

  it('rejects a near miss, the empty string, null and a number identically', () => {
    for (const input of ['sleepy', '', null, 42]) {
      const result = validateMood(input);

      expect(result.ok, JSON.stringify(input)).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_MOOD');
        expect(result.field).toBe('mood');
        expect(result.message).not.toBe('');
      }
    }
  });

  it('rejects a missing, structural or otherwise non-string value rather than throwing', () => {
    for (const input of [undefined, {}, [], ['focused'], true, { mood: 'focused' }]) {
      const result = validateMood(input);

      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
  });

  it('names the four moods in its message, so the rejection is actionable', () => {
    const result = validateMood('sleepy');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const mood of MOODS) {
        expect(result.message).toContain(mood);
      }
    }
  });
});
