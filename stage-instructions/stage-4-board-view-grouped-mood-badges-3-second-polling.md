# Stage 4: Board view — grouped, mood badges, 3-second polling

- **Type:** feature
- **Depends on:** 3

## Objectives

Spec feature 4: all members' updates, grouped by member, newest first within each group;
each member's latest mood as a badge; auto-refreshing within 5 seconds of a new post.

This is the product's headline screen. Covers **A4**, and lands the first passing version
of the **A10** primary journey in CI.

## What to build

### Server

`GET /api/board?filter=all` — Stage 6 adds `today`/`yesterday`; this stage implements the
endpoint with `all` and **must accept and ignore nothing silently**: an unrecognized
`filter` value is `400 INVALID_FILTER` from day one, so Stage 6 is purely additive.

Response exactly as `contracts/http-api-v1.md` specifies:

```jsonc
{ "filter": "all", "timezone": "<APP_TIMEZONE>", "generatedAt": "...",
  "groups": [ { "member": Member, "latestMood": Mood|null, "updates": [Update] } ] }
```

Ordering is **server-defined and normative** — the client renders the given order and does
not re-sort:

- groups by each member's newest update `createdAt` **descending**;
- ties broken by `displayName` **ascending**;
- members with no updates at all sort **last**, by `displayName`;
- updates within a group by `createdAt` **descending**.

`latestMood` comes from the member's **newest update overall**, deliberately *not* filtered
by `filter` (`persistence-v1`: `getLatestMoodByMember` is unfiltered). A member's current
mood does not vanish because you switched to "Yesterday". Stage 6 must not change this.

`canMutate` on each `Update` is computed per requester using the pure decision function
(Stage 5 makes it authoritative; here it is `authorId === req.member.id && within window`).

`Cache-Control: no-store`. The endpoint does **one** indexed query plus the mood lookup —
no N+1 per member.

### Client (ADR 0006)

- Board view: one section per member with the display name, the mood badge, and their
  updates newest first. Relative times ("4 minutes ago") with the absolute time in a
  `title`, formatted in `APP_TIMEZONE` from the response — never the viewer's zone
  (ADR 0008). A footer states the zone once.
- Mood badges: four visually distinct styles. **Distinguishable without colour alone**
  (label text, not just a colour chip) — colour-blind users and the accessibility half of
  the A8 budget.
- **Polling, exactly per ADR 0006:**
  - a single exported `POLL_INTERVAL_MS = 3000` constant — the e2e test imports it rather
    than hard-coding a sleep;
  - suspended when `document.visibilityState === 'hidden'`, resumed on `visibilitychange`
    with an **immediate** fetch;
  - no overlapping requests — an in-flight poll suppresses the next tick;
  - an immediate refetch after any local mutation;
  - a transient failure keeps the last good board rendered and retries; after **3
    consecutive** failures a non-destructive "Can't reach the board — retrying" banner
    appears over the stale data. The board never blanks on a blip.
  - the interval is cleared on unmount — no leaked timer.
- Rendering must not steal focus or scroll position when a poll brings new data; a user
  mid-composition is not interrupted.

## Interface contracts

- **Exposes:** `GET /api/board`, its ordering guarantees, and the polling client — Stage 6
  extends the `filter` parameter, Stage 5 relies on `canMutate`.
- **Consumes:** `contracts/http-api-v1.md` (`GET /api/board`, `INVALID_FILTER`, the group
  shape and ordering), `contracts/persistence-v1.md` (`listBoard`,
  `getLatestMoodByMember`), ADR 0006, ADR 0008 (display zone).

No contract changes.

## Testing requirements

**Vitest, unit**
- Group ordering: two members with interleaved timestamps produce the documented order;
  a `displayName` tiebreak on identical newest timestamps; a member with zero updates
  sorts last.
- `latestMood` reflects the newest update overall.

**Vitest, integration**
- `GET /api/board` unauthenticated → `401`.
- `?filter=bogus` → `400 INVALID_FILTER`.
- Empty database → `200` with `groups: []` — **not** a 404 and not an error.
- Two members, several updates → the exact documented ordering; `canMutate` true only for
  the requester's own in-window updates.

**Playwright**
- **A4:** two browser contexts, both signed in as different members. Context A posts;
  context B — never reloaded, kept visible — shows it within **5000 ms**. Assert with the
  criterion's own budget so a regression in the interval fails CI. Keep B's page visible or
  the visibility rule will make it look like a hang.
- **A10 first pass:** join → post → see it on the board, green in CI.
- A backgrounded tab stops polling and refetches immediately on return.

**UI-smoke asset:** on the live URL, load the board and expect at least one member group
and a mood badge rendered.

## Acceptance conditions

- [ ] **A4** — a second session sees a new update within 5 s with no manual reload
- [ ] **A10** — join → post → board is covered by a passing Playwright test in CI
- [ ] Ordering matches `http-api-v1` exactly; the client does not re-sort
- [ ] `latestMood` is unfiltered and survives a filter change (guards Stage 6)
- [ ] Polling pauses when hidden, resumes with an immediate fetch, never overlaps, and is
      cleared on unmount
- [ ] Three consecutive poll failures show a banner over stale data; the board never blanks
- [ ] Mood badges are distinguishable without relying on colour
- [ ] Times are rendered in `APP_TIMEZONE` from the response, not the viewer's zone
- [ ] Board is readable and usable at 375 px wide
- [ ] Board query is one indexed query plus the mood lookup — no N+1
- [ ] Additive migration only — expected: **no migration at all**
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — the board is the product. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
