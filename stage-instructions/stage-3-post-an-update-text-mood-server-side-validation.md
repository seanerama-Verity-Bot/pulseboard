# Stage 3: Post an update — text, mood, server-side validation

- **Type:** feature
- **Depends on:** 2

## Objectives

Spec feature 2: a composer with text and a mood picker; posting returns you to the board.
The 280-character limit is enforced **server-side and authoritatively** — the client
counter is a courtesy, not the rule.

Covers **A7** outright, completes **A1**, and lands the write half of **A3**.

## What to build

### Server

`domain/validateUpdateText.ts` (extended from the Stage 1 stub) and
`domain/validateMood.ts` — both pure:

- Text: trim, then `1 <= length <= MAX_UPDATE_LENGTH (280)`. Empty → `TEXT_EMPTY`; over →
  `TEXT_TOO_LONG`. Both `400` with `field: "text"`.
- Length is measured in **Unicode code points**, not UTF-16 units, so an emoji counts as
  one character. Pick this explicitly (`[...text].length`) and test it — `String.length`
  would reject a 280-emoji post that the UI counter said was fine.
- Mood must be one of the four `MOODS`; anything else → `400 INVALID_MOOD`.

`POST /api/updates` (behind `requireSession`):

1. `401` if no valid session.
2. Validate text, then mood.
3. `createUpdate({ authorId: req.member.id, text, mood })` — **`authorId` comes from the
   cookie**. An `authorId` in the body is ignored, never honoured (`session-cookie-v1`
   trust rules).
4. `201 { update }` with the full `Update` DTO, including `authorName` and `canMutate`
   (true immediately after posting).

### Client

- A composer in the app shell: textarea, a mood picker over exactly the four moods, submit.
- A live character counter showing remaining characters, counting **code points to match
  the server**. Past 280 it warns and disables submit — but the server still rejects
  independently, and a `TEXT_TOO_LONG` response renders politely if a stale client submits
  anyway.
- The mood picker is real radio-group semantics (keyboard-navigable, labelled), not
  clickable `div`s. One mood is required; no silent default that posts a mood the user did
  not choose.
- On success: clear the composer and **return to the board** (spec feature 2), which at
  this stage means the posted update is visible in a simple list. Stage 4 replaces that
  list with the grouped board.
- Submit is disabled while in flight; a double-click cannot post twice.
- Errors render from the `error.code`, each with its own human message.

## Interface contracts

- **Exposes:** `POST /api/updates`; the composer; `validateUpdateText` / `validateMood` as
  the single validation authority reused by Stage 5's edit path.
- **Consumes:** `contracts/http-api-v1.md` (`POST /api/updates`, `TEXT_TOO_LONG`,
  `TEXT_EMPTY`, `INVALID_MOOD`, the `Update` DTO), `contracts/session-cookie-v1.md`
  (`req.member` as the only actor source), `contracts/persistence-v1.md` (`createUpdate`).

No contract changes.

## Testing requirements

**Vitest, unit**
- `validateUpdateText`: 0, 1, 279, 280, 281 characters — 280 accepted, 281 rejected
  (**A7**'s boundary).
- Whitespace-only rejected; leading/trailing whitespace trimmed before measuring.
- A 280-emoji string accepted and a 281-emoji string rejected (code-point counting).
- `validateMood`: each of the four accepted; `'FOCUSED'`, `''`, `'sleepy'`, `null`,
  a number → rejected.

**Vitest, integration**
- `POST /api/updates` with 281 characters → `400 TEXT_TOO_LONG`, `field: "text"`, **and no
  row written** (**A7**).
- With 280 → `201`; the persisted row matches.
- With no session → `401`, no row written.
- With `authorId` set to **another member's id** in the body → the row is created for the
  **cookie's** member, not the body's. Assert the stored `authorId`.
- Invalid mood → `400 INVALID_MOOD`, no row written.

**Playwright**
- Join → post → the update appears with its text and mood (the **A1/A10** journey spine).
- Typing past 280 shows the counter warning and blocks submit.

**Restart check (A3), scripted so the Operator can run it live:** post an update →
`sudo systemctl restart pulseboard` → reload → the update is still there.

**UI-smoke asset:** on the live URL, join, post a short update, expect it visible; then
restart the service and expect it still visible.

## Acceptance conditions

- [ ] **A7** — a 281-character post is rejected cleanly server-side with no row written
- [ ] Character counting is by code point, on both client and server, and they agree
- [ ] Posting with another member's `authorId` in the body stores the **session's** member
- [ ] **A3** — a posted update survives `systemctl restart pulseboard`
- [ ] Mood picker is keyboard-accessible with proper radio semantics
- [ ] Double-submit cannot create two updates
- [ ] Every error code has its own human message; no raw status text or stack trace
- [ ] Composer usable at 375 px wide
- [ ] Additive migration only — expected: **no migration at all** (schema landed in Stage 1)
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — posting is the app's core verb. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
