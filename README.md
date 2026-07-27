# Pulseboard

A small team status board: teammates post short updates; the board shows the whole team at a glance.

> Scaffolded by [Verity](https://github.com/seanerama/verity-framework) — prompt to production, proven.

- **Live:** <https://bench-target.taile0ffc4.ts.net/>
- **Health:** <https://bench-target.taile0ffc4.ts.net/healthz>

## Specification

The complete and final build specification lives at
[`docs/benchmark-spec.md`](docs/benchmark-spec.md). Pulseboard implements
**Section "App A — Pulseboard"** plus the **Global Constraints**. That feature
list is closed: nothing outside it gets built, and its acceptance criteria
(A1–A10) are the definition of done.

## Quick start

Clone to running, verbatim. Budget: under ten minutes, most of it `npm ci`.

**Prerequisites**

- **Node 20** (`>=20 <21` — see `engines`). Check with `node --version`.
- **npm 10**, which ships with Node 20. No other package manager is needed.
- git. Nothing else: no Docker, no database server (SQLite is a file).

```bash
git clone https://github.com/seanerama-Verity-Bot/pulseboard.git
cd pulseboard

npm ci                                # installs every workspace
cp .env.example .env                  # placeholders are fine for local dev

npx prisma generate --schema apps/server/prisma/schema.prisma
npm run dev
```

Then open **<http://localhost:5173>**.

`npm run dev` runs `prisma generate` and `prisma migrate dev` for you, then starts the
Express API on `http://127.0.0.1:3001` and the Vite dev server on
`http://localhost:5173`. Vite proxies `/api` and `/healthz` through to Express, so
development is same-origin exactly like production (ADR 0003) — always use the **5173**
URL in dev.

To run the production shape locally instead (one process, one port, built assets):

```bash
npm run build
npm start          # http://127.0.0.1:3001
```

## Scripts

All of these run from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | `prisma generate` + `migrate dev`, then Express and Vite together |
| `npm run build` | Builds `packages/shared` → `apps/web` → `apps/server`, in that order |
| `npm run lint` | ESLint across every workspace |
| `npm run typecheck` | `tsc --noEmit` across every workspace |
| `npm test` | Vitest (unit + HTTP integration) across every workspace |
| `npm run test:e2e` | Playwright against the **built** app |
| `npm start` | Production entry point: `node apps/server/dist/index.js` |
| `npm run db:migrate` | `prisma migrate dev` — local schema changes |
| `npm run db:deploy` | `prisma migrate deploy` — what the host runs. Never `db push` |
| `npm run format` | Prettier |

First run of the e2e suite also needs the browser:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

## Environment variables

Copy `.env.example` to `.env` and edit. `.env` is gitignored and must stay that way; the
committed example holds placeholders only.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | One of `development`, `test`, `production` |
| `PORT` | no | `3001` | Express listens on `127.0.0.1` only (ADR 0004) |
| `DATABASE_URL` | **yes** | — | SQLite file URL — see the footgun below |
| `TEAM_CODE` | yes in production | — | The shared join code (used from Stage 2) |
| `SESSION_SECRET` | yes in production | — | **≥ 32 characters, no fallback** (ADR 0005) |
| `APP_TIMEZONE` | no | `UTC` | IANA zone; team-wide day boundaries (ADR 0008) |

Validation happens once, at boot, in `apps/server/src/env.ts`. In production a missing or
short `SESSION_SECRET`, a missing `TEAM_CODE`, or an unknown `APP_TIMEZONE` makes the
process **exit non-zero** with a message naming every problem. It never warns and
continues.

Generate a real secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The `apps/server/prisma` relative-path footgun

Prisma resolves a **relative** `file:` URL against the directory holding
`schema.prisma`, *not* against your shell's working directory (ADR 0003). So with
`DATABASE_URL="file:./dev.db"` the database lands at:

```
apps/server/prisma/dev.db
```

even though you ran the command from the repository root. If you would rather not think
about it, use an absolute URL — which is exactly what the host does
(`file:/srv/pulseboard/data/pulseboard.db`, deliberately outside the release directory so
a deploy can never clobber it).

Always pass the schema explicitly when calling Prisma from the root:

```bash
npx prisma <command> --schema apps/server/prisma/schema.prisma
```

## Repository layout

npm workspaces (ADR 0003). One lockfile, one install, one CI cache key.

```
packages/shared    @pulseboard/shared — the http-api-v1 wire types and constants,
                   declared once and imported by both sides
apps/server        Express + Prisma; also serves the built SPA (ADR 0002)
  src/http/        route registration, the ApiError envelope, the error handler
  src/domain/      PURE functions — no Express, no Prisma, no clock
  src/data/        the only importer of @prisma/client (+ the test-only seam)
  src/static/      built-SPA serving, cache headers, history fallback
  prisma/          schema.prisma + committed migrations
apps/web           React 18 + Vite 5, CSS Modules. No component library, no CSS
                   framework, no icon font (spec pin + the A8 Lighthouse budget)
e2e                Playwright specs, run against the built app
contracts          frozen interface seams — additive changes only
docs               spec, ADRs, architecture, deploy notes, UI-smoke checklists
deploy             the systemd unit installed on the host
```

`docs/architecture.md` is the narrative; `contracts/` is the law.

## Tests

```bash
npm test          # Vitest: pure domain functions + HTTP integration via supertest
npm run test:e2e  # Playwright/Chromium against `npm run build && npm start`
```

What the suite guarantees today:

- `validateUpdateText` accepts 280 characters and rejects 281, after trimming (A7).
- The environment validator rejects a short `SESSION_SECRET` and an invalid
  `APP_TIMEZONE` in production, and the loader exits non-zero when it does.
- `GET /healthz` returns `{"status":"ok","version":"…"}`.
- An unmatched `/api/*` returns a **JSON** 404 envelope — never `index.html`.
- An unhandled throw becomes `{"error":{"code":"INTERNAL_ERROR",…}}` with the stack in
  the log and never in the body.
- `/assets/*` carry `public, max-age=31536000, immutable`; `index.html` is `no-cache`.
- The built app renders the shell and a live health status in a real browser, at desktop
  and at 375 px.

## Deploy

Full, copy-pasteable instructions: **[`docs/deploy.md`](docs/deploy.md)**. The short
version (ADR 0004):

```bash
# once, on the host
sudo mkdir -p /srv/pulseboard/{current,data} && sudo chown -R bench:bench /srv/pulseboard
sudo install -m 0644 deploy/pulseboard.service /etc/systemd/system/pulseboard.service
sudo systemctl daemon-reload && sudo systemctl enable --now pulseboard
sudo tailscale funnel --bg 3001 && tailscale funnel status

# every release
npm ci && npx prisma generate --schema apps/server/prisma/schema.prisma && npm run build
rsync -az --delete ... bench-target:/srv/pulseboard/current/
ssh bench-target 'cd /srv/pulseboard/current && npx prisma migrate deploy --schema apps/server/prisma/schema.prisma'
ssh bench-target sudo systemctl restart pulseboard
curl -fsS https://bench-target.taile0ffc4.ts.net/healthz
```

Secrets live only in `/etc/pulseboard/pulseboard.env` on the host (mode `0640`, owner
`bench`). Nothing secret is ever committed.

## Status

See [`STATUS.md`](STATUS.md) for live runtime state (deployed version, environments).

## Project identity

- **slug:** `pulseboard`
- **images:** `ghcr.io/seanerama-Verity-Bot/pulseboard`
