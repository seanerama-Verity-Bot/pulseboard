/**
 * PURE (docs/architecture.md, "The load-bearing rule"). This module imports
 * nothing from `http/`, `data/`, Express or Prisma — only plain values in,
 * plain values out.
 *
 * The single authority on an update's mood (`contracts/http-api-v1.md`): it is
 * one of the four `MOODS`, exactly, or it is `400 INVALID_MOOD`. There is no
 * coercion, no case-folding and no default — `persistence-v1` stores `mood` as
 * a plain SQLite string, so this function is the only thing standing between
 * the wire and a row holding a value outside the union.
 *
 * The result shape mirrors `validateUpdateText`'s deliberately: the route
 * handler treats both the same way, and Stage 5's edit path reuses both.
 */

import { isMood, MOODS, type Mood } from '@pulseboard/shared';

export type MoodResult =
  { ok: true; value: Mood } | { ok: false; code: 'INVALID_MOOD'; message: string; field: 'mood' };

/**
 * Lists the four moods in display order. Built from `MOODS` rather than typed
 * out, so adding a mood can never leave the message stale.
 */
const MOOD_LIST = MOODS.join(', ');

const INVALID_MOOD_MESSAGE = `Pick a mood — one of: ${MOOD_LIST}.`;

/**
 * Accepts only an exact member of `MOODS`. Everything else — a wrong case
 * (`'FOCUSED'`), a near miss (`'sleepy'`), the empty string, `null`,
 * `undefined`, a number, an object — is rejected identically, because none of
 * them is a mood and the caller gains nothing from knowing which kind of
 * not-a-mood it sent.
 */
export function validateMood(input: unknown): MoodResult {
  if (!isMood(input)) {
    return { ok: false, code: 'INVALID_MOOD', message: INVALID_MOOD_MESSAGE, field: 'mood' };
  }

  return { ok: true, value: input };
}
