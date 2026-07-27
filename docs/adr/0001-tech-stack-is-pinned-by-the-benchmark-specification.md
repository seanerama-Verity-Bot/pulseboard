# 0001. Tech stack is pinned by the benchmark specification

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Pulseboard implements Section "App A — Pulseboard" of `docs/benchmark-spec.md`. That
document's "Global Constraints → Tech stack" section is explicitly **pinned, no
substitutions**, and the spec states it overrides agent preferences. No human is
available to negotiate deviations.

The relevant pins for App A:

- TypeScript throughout, **strict mode**
- Backend: Node 20 + Express; persistence: SQLite via Prisma
- Frontend: React + Vite; styling: plain CSS or CSS modules — **no UI component libraries**
- Testing: Vitest (unit/integration) + Playwright (e2e smoke)
- CI: GitHub Actions — lint, typecheck, tests green to merge

(The `ws` and gRPC pins apply to App B only and are out of scope here.)

## Decision

Adopt the pinned stack verbatim. No substitutions, no additions of UI component
libraries, CSS frameworks, ORMs other than Prisma, or test runners other than
Vitest/Playwright. Dependencies are pinned and `package-lock.json` is committed from
the first stage, per the stack-and-topology guide.

Concretely:

| Concern | Choice |
| --- | --- |
| Language | TypeScript 5.x, `strict: true`, no `any` escape hatches in reviewed code |
| Runtime | Node 20 (`engines.node: ">=20 <21"`, CI on `node-version: 20`) |
| HTTP server | Express 4 |
| DB | SQLite file, accessed only through Prisma Client |
| Migrations | Prisma Migrate (`prisma migrate deploy` in the deploy path) |
| Client | React 18 + Vite 5 |
| Styling | CSS Modules (`*.module.css`) plus a small global stylesheet |
| Unit/integration tests | Vitest |
| E2E | Playwright (Chromium; add another engine only if a criterion demands it) |
| Lint | ESLint + `@typescript-eslint`, Prettier for formatting |
| CI | GitHub Actions |

## Alternatives considered

The `stack-and-topology` guide recommends **server-rendered HTML with progressive
enhancement before a SPA**, on the grounds that fewer build steps means fewer ways to
ship a blank page. A server-rendered Express + template stack would genuinely have
suited Pulseboard: the app is small, mostly read-heavy, and its one real-time need
(auto-refresh) is satisfiable with a meta-refresh or a tiny fetch loop.

**Guide said server-rendered-first; we chose a React + Vite SPA, because the
specification pins it and explicitly overrides preferences.** This is a recorded
deviation from the guide, not an oversight.

Two consequences of that deviation are mitigated by design elsewhere:

- *Blank-screen risk* → ADR 0002 has the API server also serve the built SPA, so there
  is one artifact and one process; and the walking skeleton (Stage 0) proves the
  end-to-end render in CI and on the live host before any feature lands.
- *Lighthouse ≥ 80 (criterion A8)* → no component library, no CSS framework, no icon
  font. The bundle stays small by construction. See ADR 0002.

Also considered and rejected: Drizzle or raw `better-sqlite3` instead of Prisma
(spec pins Prisma); Tailwind or a component kit for speed (spec forbids UI component
libraries, and the plain-CSS pin makes Tailwind a bad-faith reading); Jest (spec pins
Vitest); Cypress (spec pins Playwright).

## Consequences

- Zero stack debate in later stages — builders implement, they do not re-litigate.
- Prisma's client generation becomes a build prerequisite: `prisma generate` must run
  before typecheck in CI and before build on the host, or typechecking fails on a
  missing generated client. Every stage's CI must account for this.
- Strict TypeScript across a workspace boundary means shared request/response types
  need a real home; ADR 0003 places them in a shared workspace package so the client
  and server cannot drift.
- The SPA choice pushes empty-state and error-state handling (spec: "no raw stack
  traces or blank screens") into deliberate client work rather than getting it free
  from server-rendered error pages. Planned as its own stage.
