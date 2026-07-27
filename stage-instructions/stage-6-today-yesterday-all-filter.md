# Stage 6: Today / Yesterday / All filter

- **Type:** feature
- **Depends on:** 4

## Objectives

Spec feature 5: toggle the board between updates from today, yesterday, or all.

Covers **A9** — the filter shows correct results **across a date boundary**. That is only a
testable claim once "whose day" is answered: ADR 0008 answers it with a single team-wide
`APP_TIMEZONE`, bucketed on the server.

Independent of Stage 5; both depend on Stage 4. If both are in flight, expect a small merge
in the board component.

## What to build

### Server (ADR 0008)

`domain/dayRange.ts` — pure:

```ts
export function dayRange(
  now: Date,
  timeZone: string,
  filter: 'today' | 'yesterday' | 'all',
): { gte: Date; lt: Date } | null;   // null for 'all'
```

- Uses `Intl.DateTimeFormat` with `timeZone` + `formatToParts` to find the local calendar
  day containing `now`, then converts that day's start and end back to **UTC instants**.
  No date library (ADR 0008) — Node 20 and modern browsers ship full ICU.
- `lt` is **exclusive**. `gte` is inclusive. An update at exactly midnight belongs to the
  new day.
- Correct across DST transitions: a 23-hour and a 25-hour local day both produce a range
  covering exactly that day, so no update falls into both buckets or neither.

Extend `GET /api/board?filter=today|yesterday|all`:

- default `all`; unrecognized → `400 INVALID_FILTER` (already in place from Stage 4, so
  this stage is purely additive);
- pass `dayRange(...)` into `listBoard(range)`; the range is applied to `createdAt`;
- echo `filter` and `timezone` in the response — the client labels its footer from the
  response, not from a second config channel.

**`latestMood` stays unfiltered** (`getLatestMoodByMember`). A member's current mood must
not vanish when the viewer switches to Yesterday. Stage 4 established this; do not regress
it.

A member with no updates *in the selected range* still appears with an empty `updates`
array — the board shows the team, not just the active part of it. Stage 7 owns the copy for
that per-member empty case.

### Client

- A three-way toggle in the board header: Today | Yesterday | All. Real radio-group or
  tab semantics, keyboard-operable, current selection announced.
- The filter is a **URL query parameter** (`/?filter=today`), so a view is shareable and
  survives reload. Server-side bucketing is what makes that honest.
- Polling (ADR 0006) carries the current filter; switching filters refetches immediately
  rather than waiting for the next tick.
- The zone footer reads from the response: "times shown in `<timezone>`".
- Under Today/Yesterday, the board shows only that day's updates while still displaying
  each member's current mood badge.

## Interface contracts

- **Exposes:** the `today`/`yesterday` values of the existing `filter` parameter; the filter
  toggle in the board header.
- **Consumes:** `contracts/http-api-v1.md` (`GET /api/board` filter parameter, `filter` and
  `timezone` response fields, `INVALID_FILTER`), `contracts/persistence-v1.md`
  (`listBoard(range)`, the `[createdAt]` index, `seedUpdate` for backdating),
  ADR 0008.

**Additive only.** The parameter and both response fields are already in the frozen
contract; this stage implements values the contract already names. No contract change.

## Testing requirements

**Vitest, unit — `dayRange`, with `now` passed in, so "across a date boundary" is a table
of cases rather than a test that must run at midnight:**
- `now` = 23:59:59 local → today's range still covers the whole current local day.
- `now` = 00:00:00 local → the range has rolled to the new day; yesterday covers the
  previous one.
- An update at exactly local midnight belongs to the **new** day (`lt` exclusive, `gte`
  inclusive).
- A non-UTC zone (e.g. `Pacific/Auckland`, `America/Los_Angeles`) where the local day and
  the UTC day differ: an update that is "today" locally but yesterday in UTC is bucketed
  as **today**. This is the test that would catch a naive UTC implementation.
- Across a **DST spring-forward and fall-back** day in a DST zone: the range covers exactly
  that local day; today and yesterday are contiguous and non-overlapping.
- Across a month boundary and a year boundary.
- `'all'` → `null`.
- An invalid zone name is rejected at boot, not silently coerced to UTC (assert the boot
  guard from Stage 1).

**Vitest, integration — using `seedUpdate` with backdated `createdAt`:**
- Seed one update today and one yesterday (in `APP_TIMEZONE`); `?filter=today` returns only
  the first, `?filter=yesterday` only the second, `?filter=all` both.
- Run with `APP_TIMEZONE` set to a **non-UTC** zone and confirm bucketing follows that zone,
  not UTC.
- `latestMood` is identical across all three filters (regression guard).
- A member whose only update is older than yesterday still appears under `today` with an
  empty `updates` array.
- `?filter=bogus` → `400 INVALID_FILTER`.

**Playwright**
- With a backdated update seeded, switching Today → Yesterday → All changes the visible set
  correctly, with no reload.
- The filter survives a page reload via the URL parameter.

**UI-smoke asset:** on the live URL, switch to Today and expect the toggle state and the
zone footer to render.

## Acceptance conditions

- [ ] **A9** — the filter is correct across a date boundary, proven in a non-UTC zone and
      across DST, month, and year boundaries
- [ ] Bucketing happens **server-side** in `APP_TIMEZONE`; the client never derives "today"
- [ ] `lt` exclusive / `gte` inclusive; an update at local midnight lands in the new day
- [ ] `latestMood` is unaffected by the filter
- [ ] The filter is in the URL and survives reload; polling carries it
- [ ] Toggle is keyboard-operable with correct semantics; current selection announced
- [ ] The zone footer is read from the response
- [ ] No date library added (ADR 0008) — `Intl` only
- [ ] Toggle usable at 375 px wide
- [ ] Additive migration only — expected: **no migration at all**
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — spec feature 5 within the MVP. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
