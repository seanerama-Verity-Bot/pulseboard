/**
 * PURE (docs/architecture.md, "The load-bearing rule"). This module imports
 * nothing from `http/`, `data/`, Express or Prisma — only plain values in,
 * plain values out.
 *
 * The single authority on display names (ADR 0005, `contracts/http-api-v1.md`):
 * trim, 1..40 characters after trimming, at least one non-whitespace character,
 * no control characters. Failure is `400 INVALID_DISPLAY_NAME` with
 * `field: "displayName"`.
 */

import { MAX_DISPLAY_NAME_LENGTH } from '@pulseboard/shared';

import { countCharacters } from './validateUpdateText';

export type DisplayNameResult =
  | { ok: true; value: string }
  | { ok: false; code: 'INVALID_DISPLAY_NAME'; message: string; field: 'displayName' };

/**
 * C0 controls and DEL, checked by code point rather than with a regex literal
 * so no control character has to be typed into this file.
 * `String.prototype.trim` already strips them from the ends, so what this
 * catches is a control character *inside* the name — a pasted newline, a tab,
 * a stray escape sequence.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const MISSING_MESSAGE = 'Please choose a display name so the team knows who posted.';

function reject(message: string): DisplayNameResult {
  return { ok: false, code: 'INVALID_DISPLAY_NAME', message, field: 'displayName' };
}

export function validateDisplayName(input: unknown): DisplayNameResult {
  if (typeof input !== 'string') {
    return reject(MISSING_MESSAGE);
  }

  const value = input.trim();
  const length = countCharacters(value);

  // Trimming removes leading and trailing whitespace, so an empty result also
  // covers a whitespace-only submission.
  if (length === 0) {
    return reject(MISSING_MESSAGE);
  }

  if (length > MAX_DISPLAY_NAME_LENGTH) {
    return reject(
      `A display name can be at most ${MAX_DISPLAY_NAME_LENGTH} characters — that one was ${length}.`,
    );
  }

  if (hasControlCharacter(value)) {
    return reject(
      'A display name cannot contain control characters — letters and spaces work best.',
    );
  }

  return { ok: true, value };
}
