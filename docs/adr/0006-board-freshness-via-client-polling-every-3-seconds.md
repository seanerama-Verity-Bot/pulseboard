# 0006. Board freshness via client polling every 3 seconds

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Spec feature 4 requires the board to auto-refresh "within 5 seconds of a new post
(**polling is acceptable**)". Criterion **A4**: a second browser session sees a new
update appear within 5 seconds without a manual reload.

The spec pins `ws` for App B only; App A has no real-time transport pinned, and
"polling is acceptable" is an explicit invitation.

## Decision

**Client-side polling of `GET /api/board` every 3 seconds** while the board is visible.

- **Interval: 3 s.** The budget is 5 s end-to-end. A 3 s interval gives a worst case of
  roughly 3 s plus request time, leaving real headroom for a slow request or a loaded
  host. A 5 s interval would make A4 a coin flip on its own boundary.
- **Only while visible.** The poll is suspended on `document.visibilityState === 'hidden'`
  and resumed — with an immediate fetch — on `visibilitychange` back to visible. A
  backgrounded tab does no work; a returning user sees fresh data at once rather than
  after up to 3 s.
- **Immediate refetch after a local mutation.** Posting, editing, or deleting triggers a
  board refetch straight away rather than waiting for the next tick, so the author's own
  action feels instant (feature 2: "posting returns you to the board").
- **No overlapping requests.** An in-flight poll suppresses the next tick; a request that
  outlives its interval does not stack.
- **Failures are quiet, then loud.** A transient poll failure keeps the last good board
  rendered and retries on the next tick. After 3 consecutive failures the UI shows a
  non-destructive "Can't reach the board — retrying" banner over the stale data. The
  board never blanks on a network blip and never shows a stack trace (spec quality bar).
- **Poll interval is a single exported constant** in the web app, so a criterion-driven
  change is one edit, and the e2e test can reference it rather than hard-coding a sleep.

The server helps by keeping `GET /api/board` cheap: it is a single indexed query, returns
no-store, and does no write. At one team's volume this is trivially within budget.

## Alternatives considered

1. **WebSockets (`ws`).** True push, sub-second. Rejected: the spec pins `ws` for App B
   and explicitly blesses polling for App A; adding a socket server means connection
   lifecycle, reconnect/backoff, and auth-on-upgrade — all real work, all untested by any
   App A criterion. Deliberate simplicity, not laziness.
2. **Server-Sent Events.** Lighter than WebSockets and a genuinely reasonable fit.
   Rejected for the same reason: it buys latency the criteria do not ask for, and adds a
   long-lived-connection failure mode (proxy/funnel idle timeouts) that polling does not
   have.
3. **Polling every 1 s.** Rejected: 3–5× the request volume for latency no criterion
   measures, and it eats into the A8 Lighthouse budget for nothing.
4. **`ETag` / `If-None-Match` conditional polling.** Attractive, and compatible with this
   decision. Deferred rather than rejected: it is a pure optimization on top of the same
   endpoint and can be added additively without touching the contract if the board ever
   gets large.

## Consequences

- No server-side connection state; the server stays stateless per request, which keeps
  restart behaviour (A3) simple.
- A4 is testable in Playwright without transport tricks: two browser contexts, post in
  one, `expect(...).toBeVisible({ timeout: 5000 })` in the other with no reload. The test
  asserts the criterion's own budget, so a regression in the interval fails CI.
- Background tabs and the visibility rule mean the e2e test must keep the observing page
  in a visible context, or it will appear to hang. Worth a comment in the spec file.
- Polling shows up in Lighthouse as periodic network activity; because the board response
  is small and the interval is 3 s, this stays well clear of the A8 ≥ 80 budget, but
  Lighthouse runs should be taken on a settled page.
