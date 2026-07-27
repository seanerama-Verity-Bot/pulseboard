# Stage 5: Edit and delete own updates within 15 minutes

- **Type:** feature
- **Depends on:** 4

## Objectives

Spec feature 3: edit or delete your own updates within 15 minutes of posting; after that
they are locked.

This stage carries the two criteria the spec words most sharply — **A5** (editable at
minute 14, refused at minute 16, *server-enforced, not just hidden in the UI*) and **A6**
(one member cannot edit or delete another's, *even via direct API calls*). Hiding a button
is not an implementation of either.

## What to build

### Server (ADR 0007)

`domain/mutationDecision.ts` — one pure function, the single authority for both routes:

```ts
export function mutationDecision(
  update: { authorId: string; createdAt: Date },
  actorId: string,
  now: Date,
): 'allow' | 'not-author' | 'window-expired';
```

Normative semantics, so tests and UI cannot disagree:

- measured from `createdAt`, **never** from `editedAt` — editing does not extend the lease;
- `elapsed < EDIT_WINDOW_MS` allows; exactly at or past it refuses;
- comparisons are on UTC instants, unaffected by `APP_TIMEZONE`;
- `not-author` is decided **before** `window-expired`, so probing another member's update
  leaks nothing about its age.

`PATCH /api/updates/:id` and `DELETE /api/updates/:id`, both behind `requireSession`, both
using the same ladder in this order:

1. no valid session → `401 NOT_AUTHENTICATED`
2. update not found → `404 UPDATE_NOT_FOUND`
3. `not-author` → **`403 NOT_AUTHOR`**
4. `window-expired` → **`403 EDIT_WINDOW_EXPIRED`**
5. otherwise apply

`PATCH` accepts `{ text?, mood? }`, at least one present, reusing Stage 3's
`validateUpdateText` / `validateMood` unchanged; on success it sets `editedAt = now` and
returns `200 { update }`. `DELETE` returns `204` and hard-deletes (no tombstone — the spec
has no undo and no deleted state).

The actor is always `req.member.id`. A body `authorId` is ignored.

### Client

- Edit and delete controls appear only on the requester's own updates and only while
  `canMutate` is true. Because the board re-evaluates on each poll tick, a control
  **disappears on its own** when the window lapses — no reload needed.
- Inline edit: the text and mood become editable in place, with the same 280-code-point
  counter as the composer; Cancel restores; Save issues the `PATCH`.
- Delete asks for confirmation before firing (destructive and irreversible).
- Edited updates are visibly marked ("edited 3 minutes ago").
- If a stale tab submits after the window lapses, the server's `EDIT_WINDOW_EXPIRED`
  renders as its own polite message ("That update is locked now — updates can be changed
  for 15 minutes after posting"), and `NOT_AUTHOR` renders as a different one. A generic
  "Forbidden" fails the spec's human-copy bar.

## Interface contracts

- **Exposes:** `PATCH`/`DELETE /api/updates/:id`; `mutationDecision` as the sole authority
  behind `canMutate`, which Stage 4's board already surfaces.
- **Consumes:** `contracts/http-api-v1.md` (both routes, the error ladder and its order,
  `NOT_AUTHOR`, `EDIT_WINDOW_EXPIRED`, `UPDATE_NOT_FOUND`),
  `contracts/session-cookie-v1.md` (actor from the cookie only),
  `contracts/persistence-v1.md` (`getUpdateById`, `updateUpdate`, `deleteUpdate`,
  and `seedUpdate` for backdating in tests), ADR 0007.

No contract changes.

## Testing requirements

**Vitest, unit — `mutationDecision`, `now` passed as a parameter so no clock is mocked and
nothing sleeps:**
- author, elapsed 14 min → `allow`
- author, elapsed 16 min → `window-expired`  (**A5**, both halves)
- author, elapsed exactly `EDIT_WINDOW_MS` → `window-expired` (the boundary is closed)
- author, elapsed `EDIT_WINDOW_MS - 1 ms` → `allow`
- non-author, elapsed 1 min → `not-author`
- non-author, elapsed 60 min → `not-author` (**never** `window-expired`; check order)
- an update whose `editedAt` is recent but `createdAt` is 20 min old → `window-expired`
  (editing does not extend the lease)

**Vitest, integration — real routes, real cookies, `seedUpdate` for backdated rows:**
- `PATCH` at 14 min by the author → `200`, `editedAt` set, text/mood changed.
- `PATCH` at 16 min by the author → `403 EDIT_WINDOW_EXPIRED`, **row unchanged** (**A5**,
  server-enforced).
- `PATCH` by member B on member A's in-window update → `403 NOT_AUTHOR`, row unchanged
  (**A6**).
- `DELETE` by member B on member A's update → `403 NOT_AUTHOR`, **row still present**
  (**A6**).
- `DELETE` by the author in-window → `204`, row gone; a second `DELETE` → `404`.
- `PATCH` with a body `authorId` naming member A, sent with member B's cookie → still
  `403 NOT_AUTHOR`; the body is never consulted.
- `PATCH` with 281 characters in-window → `400 TEXT_TOO_LONG`, row unchanged.
- Unknown id → `404 UPDATE_NOT_FOUND`.
- Unauthenticated `PATCH`/`DELETE` → `401`.

**Playwright**
- Two contexts: A posts; B does not see edit/delete controls on A's update, **and** a
  direct `DELETE` fired from B's context returns `403` (**A6** "even via direct API
  calls" — assert at the API, not only in the UI).
- Author edits their own update and the change is visible on the board.
- Delete removes it from the board.

**UI-smoke asset:** on the live URL, post → edit → confirm the edited text and the "edited"
marker appear; delete → confirm it is gone.

## Acceptance conditions

- [ ] **A5** — edit succeeds at minute 14 and is refused at minute 16, **server-side**,
      with the row unchanged on refusal
- [ ] **A6** — a member cannot `PATCH` or `DELETE` another's update via direct API call;
      covered by an API-level test, not only by hidden UI
- [ ] `not-author` is checked before `window-expired`, verified by test
- [ ] Editing does not extend the window (measured from `createdAt`)
- [ ] `NOT_AUTHOR` and `EDIT_WINDOW_EXPIRED` each render distinct, human copy
- [ ] Controls disappear on their own at the window boundary via the poll, without a reload
- [ ] Delete is confirmed before firing; edited updates are visibly marked
- [ ] Edit UI usable at 375 px wide
- [ ] Additive migration only — expected: **no migration at all**
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — this completes spec feature 3 within the MVP. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
