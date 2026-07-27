# 0008. Day boundaries for the Today/Yesterday filter use a pinned app timezone

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Spec feature 5: toggle the board between updates from **today**, **yesterday**, or **all**.
Criterion **A9**: the filter shows correct results **across a date boundary**.

"Today" is not a property of a timestamp; it is a property of a timestamp *plus a
timezone*. The spec does not say whose timezone. The plausible readings diverge:

- **Viewer's local timezone** — two teammates in different zones see different boards,
  and the same update is "today" for one and "yesterday" for the other.
- **A single team timezone** — everyone sees the same board; the day rolls over at one
  moment for the whole team.

A9 says the filter must be *correct* across a boundary, which is only a testable claim
once "whose day" is answered. Leaving it implicit is how this criterion fails: the server
buckets in UTC, the browser renders in local time, and an update posted at 23:30 local
appears under "Today" with a timestamp that reads yesterday.

## Decision

**One team timezone, pinned by configuration, applied on the server.**

- `APP_TIMEZONE` is an IANA zone name (e.g. `Europe/London`), read at boot, defaulting to
  `UTC`. It is validated at startup via `Intl.DateTimeFormat` — an invalid zone is a
  refuse-to-start error, not a silent fallback to UTC that produces wrong answers all
  day.
- **The server owns bucketing.** `GET /api/board?filter=today|yesterday|all` computes the
  day window in `APP_TIMEZONE`, converts it to a UTC instant range, and filters
  `createdAt` on that range in the query. The client sends a filter name and renders what
  it gets; it never derives "today" itself.
- The computation is a **pure function** in `domain/`, taking `(now, timezone, filter)`
  and returning `{ gte, lt }` UTC instants, with `lt` exclusive. Vitest tests it at
  23:59:59 and 00:00:00 in a non-UTC zone, across a DST transition, and across a
  month/year boundary — that is A9, testable without a running server.
- **Storage is UTC, always.** `createdAt` and `editedAt` are UTC instants (SQLite via
  Prisma stores them as such). No local time is ever persisted.
- **Display matches bucketing.** Timestamps on the board are formatted in `APP_TIMEZONE`
  via `Intl.DateTimeFormat`, not in the viewer's zone, so an update in the "Today" group
  never displays a yesterday time. The board states the zone once in the footer
  ("times shown in Europe/London") so a remote teammate is not quietly misled.
- The 15-minute mutation window (ADR 0007) is unaffected: it is an elapsed-duration
  comparison on UTC instants and has nothing to do with calendar days.

The zone name is also returned by `GET /api/board` in the response envelope, so the
client can label the footer without a second config channel.

## Alternatives considered

1. **Bucket in the viewer's local timezone (client-side, or by sending the browser's
   offset).** Most "natural" for a distributed team. Rejected: it makes the board a
   different board per viewer, so "the whole team at a glance" stops being one shared
   artifact, and A9 becomes untestable server-side. Sending an offset also breaks on DST
   (an offset is not a timezone).
2. **Always UTC, no configuration.** Simplest, and it is the default here. Rejected as
   the *only* option: for a team not near UTC, "today" would roll over mid-afternoon or
   mid-evening, which is visibly wrong to a user and would make A9's "correct" reading
   indefensible.
3. **Per-member timezone preference.** Rejected: the spec's Member model is display name
   plus joined-at, and adding a preference is a feature the spec does not list.
4. **A date library (Luxon, date-fns-tz).** Rejected as an avoidable dependency: Node 20
   and modern browsers both ship full ICU, so `Intl.DateTimeFormat` with
   `timeZone` + `formatToParts` computes zone-correct day boundaries directly. Keeping
   the client dependency-light also protects A8 (Lighthouse ≥ 80).

## Consequences

- `APP_TIMEZONE` joins the documented environment variables (README + `.env.example` +
  the systemd env file, ADR 0004). The live deployment sets it explicitly rather than
  relying on the default.
- A9 gets deterministic unit tests: the boundary function takes `now` as a parameter, so
  "across a date boundary" is a table of cases, not a test that must run at midnight.
- An e2e test can cover the filter's happy path by seeding an update with a backdated
  `createdAt` (the same test seam ADR 0007 needs), rather than by manipulating the
  system clock.
- Because bucketing is server-side, the filter is a query parameter and therefore
  shareable/bookmarkable, and the poll (ADR 0006) simply carries the current filter.
- If the team ever moved zones, changing `APP_TIMEZONE` re-buckets history retroactively.
  That is correct behaviour for a team-wide "today" and is noted here so it is not
  mistaken for a bug.
