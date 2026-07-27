# 0003. Repository layout: npm workspaces monorepo

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

ADR 0001 pins TypeScript strict on both sides of the wire; ADR 0002 puts the server and
the client in one deployable. Server and client nonetheless need different TypeScript
configurations (Node/CommonJS-ish module resolution and Node types vs. DOM types and
Vite's bundler resolution), different dependency sets, and different test setups.

The spec's quality bar demands a stranger gets from clone to running locally in ≤ 10
minutes, which puts a ceiling on how clever the layout may be.

The API request/response shapes are a frozen contract (`http-api-v1`). If the client
retypes them by hand, the contract can drift silently and TypeScript will happily
compile both halves of a mismatch.

## Decision

A single repository using **npm workspaces** (npm ships with Node 20 — no extra package
manager to install, which protects the 10-minute clone-to-running budget):

```
package.json              root: workspaces + the scripts a newcomer runs
package-lock.json         committed, single lockfile for the whole repo
tsconfig.base.json        strict: true, shared compiler options
packages/
  shared/                 @pulseboard/shared - contract types + pure shared constants
apps/
  server/                 @pulseboard/server - Express + Prisma (ADR 0002 layout)
    prisma/schema.prisma
  web/                    @pulseboard/web - React + Vite
e2e/                      Playwright specs + config (own workspace)
contracts/                frozen interface contracts
docs/                     benchmark spec, ADRs, architecture narrative
```

Root scripts are the documented entry points, and their names are stable for CI and for
the README:

| Script | Does |
| --- | --- |
| `npm run dev` | Prisma generate + migrate dev, then server and Vite together |
| `npm run build` | Build shared, then web, then server |
| `npm run lint` | ESLint across all workspaces |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | Vitest across all workspaces |
| `npm run test:e2e` | Playwright against a built app |

`packages/shared` is the anti-drift device: the DTOs and the error-envelope type named
by `http-api-v1`, the `Mood` union, `MAX_UPDATE_LENGTH`, and `EDIT_WINDOW_MS` are
declared once and imported by both sides. A contract change that a builder forgets to
propagate becomes a typecheck failure rather than a runtime surprise.

Dev-mode wiring: Vite dev server proxies `/api` and `/healthz` to the Express port, so
development is same-origin exactly like production and the cookie behaves identically in
both. No separate CORS configuration exists to get wrong.

## Alternatives considered

1. **One flat package with `server/` and `web/` directories.** Simplest to explain, but
   one `package.json` would mix DOM and Node type environments and one dependency set,
   which strict mode makes actively painful (`document` visible in server code,
   `process` in client code). Rejected.
2. **Two entirely separate repos.** Rejected outright: the spec and the framework treat
   Pulseboard as one project with one identity, one CI pipeline and one deploy.
3. **pnpm or Turborepo.** Better ergonomics at scale, but each adds an install step
   before a stranger can run the app, and Turborepo adds a build-graph tool to a
   three-package repo. Rejected as unearned complexity at this size.
4. **Duplicating API types in the client instead of a shared package.** Rejected: it is
   precisely the drift the contracts-first guide exists to prevent.

## Consequences

- `npm ci` at the root installs everything; CI has one install step and one cache key.
- Build order matters: `shared` must be built (or referenced via TS project references)
  before `server` and `web` typecheck. The root `build` and `typecheck` scripts encode
  the order so nobody has to remember it.
- Playwright as its own workspace keeps browser binaries and its config out of the app
  packages, and lets CI install browsers only for the e2e job.
- The `prisma/` directory lives under `apps/server`, so `DATABASE_URL` paths in the
  README and in the deploy unit are relative to that package — a documented footgun to
  state plainly in the README rather than discover on the host.
- Adding a fourth workspace later (e.g. the Act 2 Guide module, ADR 0009) is a one-line
  change to the root `workspaces` array.
