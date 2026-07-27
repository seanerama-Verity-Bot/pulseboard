# Stage 1: Walking skeleton — workspaces, Express, Prisma, SPA, full CI gate, live on bench-target

- **Type:** chore
- **Depends on:** none (blocks every other stage)

## Objectives

Prove the spine end to end before a single feature rides it: TypeScript strict compiles,
Express serves, Prisma migrates, React renders, one real unit test and one real Playwright
test pass in CI, and the whole thing is live on `bench-target` over public HTTPS.

Build **no feature** from the spec's list. If this stage feels tempting to rush past, that
is exactly the failure mode it exists to prevent.

Two things are deliberately front-loaded here rather than retrofitted:

- The **full `persistence-v1` schema** and its first migration, so no feature stage has to
  touch migrations just to add a column.
- The **Lighthouse budget** (compression, asset cache headers, no component library).
  Criterion A8 is far cheaper to protect than to recover.

## What to build

### 1. Workspace skeleton (ADR 0003)

```
package.json            npm workspaces: packages/shared, apps/server, apps/web, e2e
package-lock.json       committed
tsconfig.base.json      strict: true, target ES2022, noUncheckedIndexedAccess: true
eslint config           ESLint + @typescript-eslint (flat config is fine)
.prettierrc
.env.example            every variable in the table below, placeholder values only
```

Root scripts, named exactly this (CI, the README, and later stages depend on them):

| Script | Runs |
| --- | --- |
| `dev` | `prisma generate` + `migrate dev`, then server and Vite concurrently |
| `build` | shared → web → server, in that order |
| `lint` | ESLint across all workspaces |
| `typecheck` | `tsc --noEmit` across all workspaces |
| `test` | Vitest across all workspaces |
| `test:e2e` | Playwright against a **built** app |
| `start` | production entry: `node apps/server/dist/index.js` |

`engines.node: ">=20 <21"`.

### 2. `packages/shared`

Declares the `http-api-v1` primitives once, imported by both sides:

```ts
export type Mood = 'focused' | 'cruising' | 'blocked' | 'away';
export const MOODS: readonly Mood[];
export const MAX_UPDATE_LENGTH = 280;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export type ApiError = { error: { code: string; message: string; field?: string } };
export type Member = { id: string; displayName: string; joinedAt: string };
export type Update = { /* exactly as in contracts/http-api-v1.md */ };
```

Declare the full contract type set now so later stages import rather than invent.

### 3. `apps/server` (ADR 0002 layout)

```
src/index.ts        boot: validate env, WAL pragma, listen on PORT (default 3001)
src/http/app.ts     express app assembly, route registration
src/http/errors.ts  ApiError envelope + the global error handler
src/domain/         pure functions (this stage lands at least one real one)
src/data/prisma.ts  single PrismaClient instance
src/static/         built-SPA serving + history fallback
prisma/schema.prisma
prisma/migrations/  first migration, committed
```

Required behaviour:

- `GET /healthz` → `200 {"status":"ok","version":"<sha|pkg version>"}`. No auth, no DB write.
- **Global error handler** converts any thrown error into the `ApiError` envelope with code
  `INTERNAL_ERROR` and a generic message. Stack traces are logged, never sent.
- **Unmatched `/api/*` → JSON 404** in the error envelope (code `NOT_FOUND`), never
  `index.html`. Assert this in a test — it is the blank-screen bug in embryo.
- **SPA fallback** for unmatched non-`/api` GET requests → `index.html`.
- **Static headers (A8 budget):** `Cache-Control: public, max-age=31536000, immutable` for
  Vite's content-hashed assets under `/assets/`; `no-cache` for `index.html`. Enable
  `compression()`.
- **Env validation at boot**, in one place, failing fast with a clear message:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | |
| `PORT` | no | `3001` | ADR 0004 |
| `DATABASE_URL` | yes | — | |
| `TEAM_CODE` | yes in production | — | consumed from Stage 2 |
| `SESSION_SECRET` | yes in production | — | **≥ 32 chars, no fallback** (ADR 0005) |
| `APP_TIMEZONE` | no | `UTC` | validated via `Intl.DateTimeFormat` (ADR 0008) |

In production, a missing/short `SESSION_SECRET` or an invalid `APP_TIMEZONE` **exits
non-zero at boot**. Do not warn and continue.

- Prisma: the **complete** `Member` + `Update` schema from `contracts/persistence-v1.md`,
  first migration generated and committed. `PRAGMA journal_mode = WAL` at startup.
- `src/data/testing.ts` exporting `seedUpdate({ ..., createdAt })`, imported by no
  production path. Stages 5 and 6 depend on it existing.

### 4. `apps/web`

React 18 + Vite 5, CSS Modules. **No UI component library, no CSS framework, no icon
font** — a spec pin and the A8 budget.

- A single **app shell** component wrapping all content (header + main). Every later route
  mounts inside it. This is also what keeps a future Act 2 Guide mount to one line
  (ADR 0009) — but build no Guide code now.
- A minimal view that fetches `/healthz` and renders the status, plus a graceful failure
  message if the fetch fails. No blank screen in either state.
- Vite dev server proxies `/api` and `/healthz` to the server port, so dev is same-origin
  exactly like production (ADR 0003).
- A global stylesheet with shared tokens (colour, spacing, type scale) and a `max-width`
  content column that is usable at **375 px** from the start.

### 5. `e2e`

Playwright, Chromium. Config starts the **built** app (`npm run build && npm start`) via
`webServer`. One spec: load `/`, assert the shell renders and the health status is visible.

### 6. CI — grow the hygiene gate into the real gate

Extend `.github/workflows/ci.yml`. **Keep the existing `structure` and `secret-scan` jobs**
— branch protection requires them by name. Add a `build-and-test` job on Node 20:

```
npm ci
npx prisma generate --schema apps/server/prisma/schema.prisma   # BEFORE typecheck
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Upload the Playwright report as an artifact on failure. `prisma generate` before typecheck
is not optional — without it, typecheck fails on a missing generated client.

### 7. Deploy to `bench-target` (ADR 0004, `.verity/deploy-access.md`)

- Prepare the host: `/srv/pulseboard/{current,data}`, `/etc/pulseboard/pulseboard.env`
  (mode `0640`, owner `bench`) populated with the variables above.
- Install `pulseboard.service`: `Restart=always`, `After=network-online.target`,
  `EnvironmentFile=/etc/pulseboard/pulseboard.env`, `WantedBy=multi-user.target`, then
  `systemctl enable --now`.
- Publish: `sudo tailscale funnel --bg 3001`; confirm with `tailscale funnel status`.
- `prisma migrate deploy` on the host — never `migrate dev`, never `db push`.
- Commit the unit file and deploy notes. Commit **no secrets**.

### 8. README

Clone → running in ≤ 10 minutes, verbatim-runnable: prerequisites, `npm ci`, copy
`.env.example` to `.env`, `npm run dev`, the URL. Plus the env-var table, the
`apps/server/prisma` relative-path footgun (ADR 0003), the live URL, and the deploy/funnel
commands.

## Interface contracts

- **Exposes:** the workspace layout and root scripts; `packages/shared` types; the
  `ApiError` envelope and global error handler; the Prisma schema and first migration; the
  `seedUpdate` test seam; the app shell; the CI gate; the live host, unit, and funnel.
- **Consumes:** `contracts/persistence-v1.md` (implemented in full),
  `contracts/http-api-v1.md` (envelope, `/healthz`, the 404 rule),
  `contracts/session-cookie-v1.md` (only the `SESSION_SECRET` boot requirement);
  ADRs 0001–0004 and 0008.

## Testing requirements

- **Vitest, unit:** at least one genuine `domain/` function with real branches — implement
  `validateUpdateText` (empty / 280 / 281 → the `TEXT_*` codes) and test the boundary. A
  test asserting `true === true` fails this stage.
- **Vitest, integration:** `/healthz` returns the documented shape; an unmatched `/api/*`
  returns **JSON** 404, not HTML; a thrown error surfaces as the `ApiError` envelope with
  no stack trace in the body.
- **Playwright:** the built app serves the shell and renders health status.
- **UI-smoke asset** for the Operator: load the live URL → 200, shell heading visible,
  `/healthz` → 200.

## Acceptance conditions

- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` passes from a clean clone
- [ ] TypeScript strict; no `any` in reviewed code; lockfile committed
- [ ] Prisma schema matches `persistence-v1` in full; first migration committed; WAL enabled
- [ ] Missing/short `SESSION_SECRET` or invalid `APP_TIMEZONE` exits non-zero in production
- [ ] Unmatched `/api/*` returns a JSON error envelope, never `index.html`
- [ ] Static assets carry immutable cache headers; `index.html` is `no-cache`; compression on
- [ ] CI runs lint + typecheck + test + build + Playwright and is green on the PR
- [ ] `structure` and `secret-scan` jobs still present and green
- [ ] Live on `https://bench-target.taile0ffc4.ts.net/` over HTTPS; `/healthz` → 200 live
- [ ] `sudo systemctl restart pulseboard` leaves the service healthy (rehearses A3)
- [ ] No secrets in git; `.env.example` placeholders only
- [ ] README gets a stranger from clone to running in ≤ 10 minutes
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A, deliberately — this stage *is* the spine and there is no prior
behaviour to fall back to. See `feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: YES

This stage's real purpose is to prove the pipeline itself: CI gate, deploy path, live
smoke. If any of those is faked or deferred, the stage is not done.
