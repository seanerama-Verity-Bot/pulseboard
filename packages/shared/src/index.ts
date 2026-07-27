/**
 * `@pulseboard/shared` — the single declaration site for the `http-api-v1` wire
 * primitives (ADR 0003). Both `apps/server` and `apps/web` import from here; a
 * hand-copied duplicate on either side is a contract violation.
 *
 * Nothing in this package may import Express, React, Prisma or Node built-ins:
 * it has to compile under both the DOM and the Node type environments.
 */

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** The four moods, exactly. `contracts/http-api-v1.md`. */
export type Mood = 'focused' | 'cruising' | 'blocked' | 'away';

/** Runtime companion to {@link Mood}. Order is the display order. */
export const MOODS: readonly Mood[] = ['focused', 'cruising', 'blocked', 'away'] as const;

/** Maximum length of an update's text, after trimming (criterion A7). */
export const MAX_UPDATE_LENGTH = 280;

/** Maximum display-name length, after trimming. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** How long after posting an update may still be edited or deleted (ADR 0007). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Name of the signed session cookie (`session-cookie-v1`). */
export const SESSION_COOKIE_NAME = 'pb_session';

/** Board polling interval used by the client (ADR 0006). */
export const BOARD_POLL_INTERVAL_MS = 3000;

/** Type guard for {@link Mood}; the domain layer validates on the way in. */
export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

/**
 * Counts Unicode **code points** rather than UTF-16 code units, so an astral
 * character (an emoji, say) costs one character rather than two.
 *
 * It lives here rather than in either app because the server's authoritative
 * `MAX_UPDATE_LENGTH` check and the client's courtesy counter have to agree
 * exactly: a counter that said "fine" for a 280-emoji post the server then
 * rejected would be a bug the user cannot explain.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/* ------------------------------------------------------------------ *
 * Error envelope
 * ------------------------------------------------------------------ */

/**
 * Every error, at every status, is exactly this shape. No stack traces, no
 * framework HTML error pages, no bare status text.
 */
export type ApiError = {
  error: {
    /** Stable and machine-readable; the client switches on this. */
    code: string;
    /** Human, polite, safe to show a user verbatim. */
    message: string;
    /** Present on validation failures. */
    field?: string;
  };
};

/**
 * The closed v1 error-code registry. Additions are additive only.
 * `NOT_FOUND` is the transport-level code for an unmatched `/api/*` route.
 */
export const API_ERROR_CODES = [
  'INVALID_TEAM_CODE',
  'INVALID_DISPLAY_NAME',
  'NOT_AUTHENTICATED',
  'NOT_AUTHOR',
  'EDIT_WINDOW_EXPIRED',
  'UPDATE_NOT_FOUND',
  'TEXT_TOO_LONG',
  'TEXT_EMPTY',
  'INVALID_MOOD',
  'INVALID_FILTER',
  'INTERNAL_ERROR',
  'NOT_FOUND',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/* ------------------------------------------------------------------ *
 * Resources
 * ------------------------------------------------------------------ */

export type Member = {
  id: string;
  /** 1..40 chars, trimmed. */
  displayName: string;
  /** ISO-8601 UTC, `Z` suffix. */
  joinedAt: string;
};

export type Update = {
  id: string;
  authorId: string;
  /** Denormalized for rendering; server-supplied. */
  authorName: string;
  /** 1..280 chars. */
  text: string;
  mood: Mood;
  /** ISO-8601 UTC, `Z` suffix. */
  createdAt: string;
  /** ISO-8601 UTC, `Z` suffix, or `null` when never edited. */
  editedAt: string | null;
  /**
   * The server's verdict for THIS requester, right now: requester is the author
   * AND within `EDIT_WINDOW_MS`. A UI convenience only — never the enforcement
   * (ADR 0007).
   */
  canMutate: boolean;
};

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

export type BoardFilter = 'today' | 'yesterday' | 'all';

export const BOARD_FILTERS: readonly BoardFilter[] = ['today', 'yesterday', 'all'] as const;

export function isBoardFilter(value: unknown): value is BoardFilter {
  return typeof value === 'string' && (BOARD_FILTERS as readonly string[]).includes(value);
}

export type BoardGroup = {
  member: Member;
  /** From the member's newest update overall, NOT filtered by `filter`. */
  latestMood: Mood | null;
  /** Newest first; may be empty under a filter. */
  updates: Update[];
};

export type BoardResponse = {
  filter: BoardFilter;
  /** The `APP_TIMEZONE` bucketing/display zone (ADR 0008). */
  timezone: string;
  /** ISO-8601 UTC, `Z` suffix. */
  generatedAt: string;
  groups: BoardGroup[];
};

/* ------------------------------------------------------------------ *
 * Requests and responses
 * ------------------------------------------------------------------ */

export type CreateSessionRequest = {
  teamCode: string;
  displayName: string;
};

export type SessionResponse = {
  member: Member;
};

export type CreateUpdateRequest = {
  text: string;
  mood: Mood;
};

/** At least one field must be present. */
export type PatchUpdateRequest = {
  text?: string;
  mood?: Mood;
};

export type UpdateResponse = {
  update: Update;
};

export type HealthResponse = {
  status: 'ok';
  /** Git sha when available, otherwise the server package version. */
  version: string;
};
