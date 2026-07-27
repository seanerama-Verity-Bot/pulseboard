# 0007. Server-enforced 15-minute mutation window and author-only ownership

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Spec feature 3: edit/delete your own updates within 15 minutes of posting; after that
they are locked. Two criteria hold the implementation to account:

- **A5** — editing is possible at minute 14 and refused at minute 16, **server-enforced,
  not just hidden in the UI**.
- **A6** — one member cannot edit or delete another member's update, **even via direct
  API calls**.

Both are explicitly framed as "the UI hiding the button is not the answer". A5 also
implies the boundary must be testable without waiting 16 real minutes.

## Decision

**One authority.** A single pure function in `apps/server/src/domain/` decides:

```ts
export const EDIT_WINDOW_MS = 15 * 60 * 1000;   // exported from @pulseboard/shared

export function mutationDecision(
  update: { authorId: string; createdAt: Date },
  actorId: string,
  now: Date,
): 'allow' | 'not-author' | 'window-expired';
```

Every `PATCH /api/updates/:id` and `DELETE /api/updates/:id` calls it. It is pure, takes
`now` as a parameter, and imports nothing from Express or Prisma — so Vitest can test
minute 14, minute 16, and the exact boundary as ordinary function calls with no clock
mocking and no sleeping.

**Order of checks and their status codes** (deliberate, and the same for edit and
delete):

1. No valid session → `401 NOT_AUTHENTICATED` (ADR 0005).
2. Update does not exist → `404 UPDATE_NOT_FOUND`.
3. `update.authorId !== req.member.id` → **`403 NOT_AUTHOR`**.
4. `now - update.createdAt >= EDIT_WINDOW_MS` → **`403 EDIT_WINDOW_EXPIRED`**.
5. Otherwise apply, set `editedAt = now` on edit.

The actor is always `req.member.id` from the signed cookie; an `authorId` in the request
body is ignored, never trusted (ADR 0005). The non-author check runs **before** the
window check, so a stranger probing another member's update learns nothing about its
age.

**Boundary semantics, stated once so tests and UI agree:** the window is measured from
`createdAt`, never from `editedAt` — editing does not extend the lease. Elapsed time
strictly less than `EDIT_WINDOW_MS` is allowed; exactly at or past it is refused
(`elapsed < EDIT_WINDOW_MS`). Minute 14 → allow. Minute 16 → refuse. All comparisons are
on UTC instants, immune to the display-timezone question of ADR 0008.

**The client mirrors, it does not decide.** The board hides the edit/delete controls once
an update is older than the window (and re-evaluates on each poll tick, so a control
disappears on its own without a reload), and it renders the server's
`EDIT_WINDOW_EXPIRED` error politely if a stale tab submits anyway. The hiding is
courtesy; the 403 is the rule.

`EDIT_WINDOW_MS` lives in `@pulseboard/shared` so both halves read the same number
(ADR 0003). It is **not** configurable by environment: the spec fixes 15 minutes, and a
knob would be an untested code path plus a way to make A5 fail in production while
passing in CI.

## Alternatives considered

1. **A `lockedAt` column written at insert time, compared directly.** Rejected: it stores
   a derived value, so a clock skew or a data import can produce rows whose lock time
   disagrees with their creation time. Deriving from `createdAt` has exactly one source
   of truth.
2. **A background job that flips an `isLocked` flag at 15 minutes.** Rejected: a timer
   that must survive restarts (A3) to keep the rule true, replacing a subtraction.
3. **Enforcing only in the route handlers, without a domain function.** Rejected: the
   rule would be duplicated across edit and delete and would need an HTTP-level test to
   verify each boundary. One pure function is tested directly and reused twice.
4. **`410 Gone` for the expired window instead of `403`.** Rejected: the update still
   exists and is still readable; `403` with a distinguishing error code is the honest
   status. The distinct codes (`NOT_AUTHOR` vs `EDIT_WINDOW_EXPIRED`) let the client
   write two different, human messages.
5. **Making the window configurable for testing.** Rejected — see above; the tests take
   `now` as a parameter instead, which is strictly better because it tests the shipped
   constant.

## Consequences

- A5 and A6 are covered by fast unit tests on the pure function *and* by API-level
  integration tests that hit the real routes with real cookies. The e2e layer does not
  need to wait 16 minutes: integration tests seed an update with a backdated `createdAt`.
- Backdating in tests requires the repository layer to accept an explicit `createdAt` on
  a seed path (test-only helper, not an API field) — a small, deliberate seam.
- Two distinct 403 codes must both be represented in the client's error copy; a generic
  "Forbidden" would fail the spec's "helpful, human" bar.
- Delete is a hard delete (no tombstone). The spec has no undo, no audit, and no
  "deleted" state in its data model, so a soft-delete column would be unused surface.
