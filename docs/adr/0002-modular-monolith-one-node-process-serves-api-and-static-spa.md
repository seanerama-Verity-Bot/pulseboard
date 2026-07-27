# 0002. Modular monolith: one Node process serves API and static SPA

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Pulseboard is one team per deployment, no accounts beyond a display name, a handful of
updates per day, and a single deployment host (`bench-target`, ADR 0004). App A has no
independent scaling axis, no team ownership boundary, and no second runtime.

The stack-and-topology guide is explicit: start as a modular monolith; every service
added multiplies the CI build matrix, the image set, and the deploy surface, and the
slug extends per service (`ghcr.io/<owner>/<slug>-<service>`).

The frontend is a Vite SPA (ADR 0001), which produces static assets that something must
serve.

## Decision

**One deployable process.** The Express server is the whole runtime:

- `/api/*` — the JSON API (contract `http-api-v1`).
- `/healthz` — liveness probe, no auth, no DB write.
- Everything else — static assets from the built client, with an SPA history fallback
  that returns `index.html` for unmatched non-`/api` GET routes so client-side routes
  survive a hard reload.

Internally the server is **modular**, with seams that would let a split happen later
without a rewrite:

```
apps/server/src/
  http/        express app, middleware, route registration, error handler
  domain/      pure logic: mood rules, 280-char validation, 15-minute window,
               day-boundary bucketing  <- the Vitest unit-test target
  data/        Prisma client + repository functions (the only place Prisma is imported)
  session/     cookie sign/verify, team-code check
  static/      SPA serving + history fallback
```

The rule that keeps the seam honest: **`domain/` imports nothing from `http/`, `data/`,
or `express`.** It takes plain values and returns plain values, so the acceptance
criteria with sharp edges (A5 the 15-minute window, A7 the 280-character limit, A9 the
date boundary) are unit-testable without a server or a database.

The image stays `ghcr.io/seanerama-Verity-Bot/pulseboard` — no per-service suffix,
because there is one service.

## Alternatives considered

1. **Two services (API + a separate static host/CDN for the SPA).** The conventional
   SPA split. Rejected: `bench-target` is one host reachable publicly through exactly
   one Tailscale Funnel mapping (ADR 0004). Two origins would mean either a second
   public entry point we do not have, or a reverse proxy we would have to introduce and
   operate — and it would add CORS and cookie `SameSite` complexity to an app whose
   entire auth story is one cookie. Pure cost, no benefit at this size.
2. **A separate "board poller" service.** Rejected as invented complexity; polling is a
   client concern (ADR 0006).
3. **Serverless functions.** Rejected: SQLite on local disk is pinned by the spec and
   wants a long-lived filesystem.

The guide recommended a modular monolith and the project has no reason to deviate; this
ADR follows the guide.

## Consequences

- One CI build, one artifact, one systemd unit, one funnel mapping. Deploy is a file
  sync plus a service restart.
- Same-origin API means the session cookie needs no CORS handling and can be
  `SameSite=Lax` (ADR 0005).
- The static-serving path is on the hot path for criterion **A8** (Lighthouse ≥ 80).
  The server must send `Cache-Control: public, max-age=31536000, immutable` for Vite's
  content-hashed assets and `no-cache` for `index.html`, and enable compression. This is
  walking-skeleton work, not a later optimization — a Lighthouse score is much harder to
  recover than to protect.
- The history fallback must not swallow API 404s: an unmatched `/api/*` route returns a
  JSON 404 in the contract's error envelope, never `index.html`. A client that receives
  HTML where it expects JSON produces exactly the blank-screen failure the spec forbids.
- If the app ever needed a split, `domain/` and `data/` are already free of Express.
