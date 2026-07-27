/**
 * PURE (docs/architecture.md, "The load-bearing rule"). This module imports
 * nothing from `http/`, `data/`, Express or Prisma — only plain values in,
 * plain values out — which is what makes criterion A7 provable without a
 * database, a server or a browser.
 */

import { MAX_UPDATE_LENGTH } from '@pulseboard/shared';

export type UpdateTextErrorCode = 'TEXT_EMPTY' | 'TEXT_TOO_LONG';

export type UpdateTextResult =
  | { ok: true; value: string }
  | { ok: false; code: UpdateTextErrorCode; message: string; field: 'text' };

/**
 * Counts Unicode code points rather than UTF-16 code units, so an astral
 * character (an emoji, say) costs one character rather than two.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/**
 * The single authority on update text (`contracts/http-api-v1.md`):
 * trims, rejects empty, rejects anything longer than `MAX_UPDATE_LENGTH`
 * *after* trimming, and returns the trimmed value to store.
 */
export function validateUpdateText(input: unknown): UpdateTextResult {
  if (typeof input !== 'string') {
    return {
      ok: false,
      code: 'TEXT_EMPTY',
      message: 'An update needs some text.',
      field: 'text',
    };
  }

  const value = input.trim();
  const length = countCharacters(value);

  if (length === 0) {
    return {
      ok: false,
      code: 'TEXT_EMPTY',
      message: 'An update needs some text.',
      field: 'text',
    };
  }

  if (length > MAX_UPDATE_LENGTH) {
    return {
      ok: false,
      code: 'TEXT_TOO_LONG',
      message: `An update can be at most ${MAX_UPDATE_LENGTH} characters — that one was ${length}.`,
      field: 'text',
    };
  }

  return { ok: true, value };
}
