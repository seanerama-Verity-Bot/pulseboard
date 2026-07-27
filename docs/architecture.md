# Pulseboard — Architecture

The design that the stage backlog implements. Source of truth for *what to build* is
[`docs/benchmark-spec.md`](benchmark-spec.md), Section "App A — Pulseboard" plus the
Global Constraints. This document records *how*, and every non-obvious choice links to
the ADR that argued it.

## One paragraph

Pulseboard is a single Node 20 process. Express serves a small JSON API under `/api` and
also serves the built React SPA as static files, so there is one artifact, one port, one
systemd unit and one public URL. State lives in a SQLite file reached only through
Prisma. Identity is a signed, HTTP-only cookie issued when someone presents the shared
team code — there is no session store and no password. The board stays fresh by polling
every 3 seconds. Everything with a sharp edge — the 280-character limit, the 15-minute
edit window, ownership, and what "today" means — is enforced on the server by pure
functions that unit tests call directly.

## Topology

```
                    https://bench-target.taile0ffc4.ts.net/
                                     │  Tailscale Funnel (TLS, Let's Encrypt)
                                     ▼
                          127.0.0.1:3001  ── systemd: pulseboard.service
        ┌────────────────────────────────────────────────────────┐
        │  apps/server  (Express, Node 20)                       │
        │                                                        │
        │   http/     routes · requireSession · error envelope   │
        │   session/  HMAC cookie sign/verify · team-code check  │
        │   domain/   PURE: 280-char · 15-min window · ownership │
        │             · day boundaries · mood validation         │
        │   data/     Prisma repositories (only Prisma importer) │
        │   static/   built SPA + history fallback               │
        └────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
        /srv/pulseboard/data/pulseboard.db    apps/web/dist  (React + Vite)
        (SQLite, WAL, outside the release dir)
```

One service. The image stays `ghcr.io/seanerama-Verity-Bot/pulseboard` with no
per-service suffix. → **ADR 0002**, **ADR 0004**

## The load-bearing rule

**`domain/` is pure.** It imports nothing from `http/`, `data/`, `express`, or Prisma; it
takes plain values (including `now: Date`) and returns plain values.

That single constraint is why the trickiest acceptance criteria are cheap to prove:

| Criterion | Pure function under test | No need for |
| --- | --- | --- |
| A5 — edit at min 14, refused at min 16 | `mutationDecision(update, actorId, now)` | a clock, a sleep, a server |
| A6 — cannot touch another's update | same function, `'not-author'` branch | a second browser |
| A7 — 281 chars rejected | `validateUpdateText(text)` | a database |
| A9 — filter across a date boundary | `dayRange(now, timezone, filter)` | midnight |

The HTTP layer then re-proves each one through the real routes, and Playwright proves the
journey. Three layers, one authority.

## Repository layout

npm workspaces; `packages/shared` holds the wire types so client and server cannot drift.
→ **ADR 0003**

```
packages/shared   Mood, MAX_UPDATE_LENGTH, EDIT_WINDOW_MS, API DTOs, ApiError
apps/server       Express + Prisma (layout above); prisma/schema.prisma + migrations
apps/web          React + Vite; CSS Modules only, no component library
e2e               Playwright specs
contracts         frozen seams (below)
docs              spec, ADRs, this file
```

## Frozen contracts

Additive-only from here; a breaking change is a new contract, never an edit.

| Contract | Seam | Holds |
| --- | --- | --- |
| [`http-api-v1`](../contracts/http-api-v1.md) | web ↔ server | endpoints, DTOs, the error envelope, the closed error-code registry, board ordering |
| [`session-cookie-v1`](../contracts/session-cookie-v1.md) | browser ↔ server | `pb_session` format, HMAC-SHA-256 signing, normative verification order, the trust rules behind A6 |
| [`persistence-v1`](../contracts/persistence-v1.md) | server ↔ SQLite | Prisma models, the repository seam, UTC-only timestamps, migration policy |

Every error, at every status, is `{ error: { code, message, field? } }`. No stack traces,
no framework HTML error pages — the spec forbids both.

## Decisions at a glance

| # | Decision | Why it matters here |
| --- | --- | --- |
| [0001](adr/0001-tech-stack-is-pinned-by-the-benchmark-specification.md) | Stack pinned by the spec | Deviates from the guide's server-rendered-first lean, on the spec's authority — recorded, not accidental |
| [0002](adr/0002-modular-monolith-one-node-process-serves-api-and-static-spa.md) | Modular monolith, one process serves API + SPA | One artifact, one funnel, same-origin cookie |
| [0003](adr/0003-repository-layout-npm-workspaces-monorepo.md) | npm workspaces + `packages/shared` | Contract drift becomes a typecheck failure |
| [0004](adr/0004-deploy-to-bench-target-on-port-3001-via-systemd-and-tailscale-f.md) | `bench-target`, loopback :3001, systemd, Tailscale Funnel | DB outside the release dir ⇒ A3 is structural |
| [0005](adr/0005-team-code-join-with-a-signed-http-only-session-cookie.md) | Team code → signed HMAC cookie, no session store | Unforgeable identity ⇒ A6; nothing to lose on restart |
| [0006](adr/0006-board-freshness-via-client-polling-every-3-seconds.md) | Poll every 3 s, pause when hidden | 3 s inside a 5 s budget ⇒ A4 has headroom |
| [0007](adr/0007-server-enforced-15-minute-mutation-window-and-author-only-owner.md) | One pure `mutationDecision`, checked server-side | A5 + A6; UI hiding is courtesy, the 403 is the rule |
| [0008](adr/0008-day-boundaries-for-the-today-yesterday-filter-use-a-pinned-app.md) | `APP_TIMEZONE` team-wide day boundaries, server-bucketed | Makes "today" a testable claim ⇒ A9 |
| [0009](adr/0009-decline-the-catalog-helper-bot-act-2-guide-is-deferred-until-af.md) | Decline catalog `helper-bot`; Act 2 Guide deferred | Spec gates Guide behind a live MVP; catalog feature needs an LLM the non-goals forbid |
| [0010](adr/0010-branch-protection-on-main-from-the-planning-commit-onward.md) | Branch protection on `main` before any code stage | Every code change rides a PR + green CI; Stage 1 adds `build-and-test` to the required checks |

## Walking skeleton (Stage 0)

The thinnest slice that is real end to end. It builds nothing from the feature list — its
whole job is to prove the spine before any feature rides it, and to protect the Lighthouse
budget from day one rather than recover it later.

**In scope**

1. Workspaces, `tsconfig.base.json` with `strict: true`, ESLint + Prettier, committed
   lockfile.
2. Express app: `/healthz`, the JSON error envelope, the 404-for-unmatched-`/api` rule,
   compression, and the asset cache headers from ADR 0002.
3. Prisma wired to SQLite with the **full `persistence-v1` schema** and its first
   migration committed. Schema-first here means no feature stage has to touch migrations
   just to add a column.
4. React + Vite app shell that calls `/healthz` and renders the result — plus the single
   wrapping shell component that later routes mount into.
5. Server serves `apps/web/dist` with the SPA history fallback. Production runs from one
   process on one port.
6. **One real Vitest unit test** (a `domain/` function, not a tautology) and **one real
   Playwright test** that loads the served page and asserts rendered content.
7. **CI grown from hygiene to the full gate**: install → `prisma generate` → lint →
   typecheck → test → build → Playwright. This is the progressive-gate step; from here on
   every PR must clear it.
8. **Deployed to `bench-target`** per ADR 0004: host prepared, systemd unit installed,
   funnel published, `/healthz` answering on the public HTTPS URL.

**Done when** CI is green on the PR, the public URL serves the shell over HTTPS,
`/healthz` returns 200 live, and `sudo systemctl restart pulseboard` leaves it healthy.

Stage 0 blocks every feature stage.

## Criterion → stage map

Planning owns the final backlog; this is the architect's coverage intent, so nothing is
orphaned.

| Criterion | Where it lands |
| --- | --- |
| A1 join + post in < 2 min, no docs | Join, Post |
| A2 wrong code → polite error | Join |
| A3 survives full server restart | Stage 0 (DB path) + verified at Post |
| A4 second session sees it in < 5 s | Board (polling) |
| A5 editable at 14 min, refused at 16 | Edit/Delete |
| A6 no cross-member mutation via API | Session (Stage 0/Join) + Edit/Delete |
| A7 281 chars rejected server-side | Post |
| A8 Lighthouse ≥ 80 live | Stage 0 budget + Polish stage verifies |
| A9 filter correct across a date boundary | Filter |
| A10 primary journey in Playwright, in CI | Board (first pass) + Polish (full journey) |

## Deliberately not built

Multiple teams, DMs, reactions, file uploads, notifications, avatars (App A non-goals);
payments, email, push, OAuth, admin dashboards, analytics, i18n, Docker, any AI/LLM call
(global non-goals). The Act 2 Guide is a separate, later feature request — **ADR 0009**.
