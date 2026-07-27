# Stage 2: Join — team code and signed session

- **Type:** feature
- **Depends on:** 1

## Objectives

Spec feature 1: a landing page asks for the team code and a display name; a wrong code
shows a clear error. This is the app's only door, and it is also where criterion **A6**'s
foundation is laid — identity must be unforgeable from the client.

Covers **A2** outright, and the first half of **A1** (a stranger gets in with no
documentation).

## What to build

### Server (ADR 0005, `contracts/session-cookie-v1.md`)

`src/session/cookie.ts` — pure and small enough to read in full:

- `sign(payload): string` → `base64url(JSON).base64url(HMAC-SHA256)` keyed by
  `SESSION_SECRET`. The HMAC covers the **encoded payload segment as transmitted**; never
  re-serialize JSON to verify.
- `verify(cookieValue): SessionPayload | null` — the normative order from the contract:
  two segments → timing-safe HMAC compare → JSON parse and shape check → `issuedAt` not
  older than 30 days. Any failure returns `null`; none of them throws, and none reveals
  which check failed.
- Cookie attributes: `HttpOnly`; `Secure` **only when `NODE_ENV === 'production'`**;
  `SameSite=Lax`; `Path=/`; `Max-Age=2592000`. The `Secure`-in-dev trap breaks local login
  silently — test both modes.

`src/session/teamCode.ts` — `crypto.timingSafeEqual` over equal-length buffers, with a
length pre-check so unequal lengths do not throw. Never log or echo the expected code.

`src/http/middleware/requireSession.ts` — verifies, attaches
`req.member = { id, displayName }`, else `401 NOT_AUTHENTICATED` in the error envelope and
clears the stale cookie.

Routes:

| Route | Behaviour |
| --- | --- |
| `POST /api/session` | validate code → validate display name → find-or-create Member → set cookie → `201 { member }` |
| `GET /api/session` | `200 { member }` when signed in, else `401 NOT_AUTHENTICATED` |
| `DELETE /api/session` | `204`, clears the cookie, idempotent |

Display-name validation (`domain/validateDisplayName.ts`, pure): trim; 1–40 characters
after trimming; must contain a non-whitespace character; reject control characters. Failure
→ `400 INVALID_DISPLAY_NAME` with `field: "displayName"`.

Find-or-create keys on `normalizedName` = lowercased, whitespace-collapsed
(`persistence-v1`), so a returning teammate re-joins as themselves rather than spawning a
duplicate Member. `joinedAt` is set on creation only, never refreshed.

### Client

- A join view: team-code field, display-name field, submit. Sensible `autocomplete`,
  labels tied to inputs, submit on Enter, disabled while in flight.
- `GET /api/session` on app load decides join view vs. signed-in view. A `401` here is a
  **normal signal**, not an error to render.
- `INVALID_TEAM_CODE` → a visible, polite, non-blaming message next to the field
  (criterion **A2**). `INVALID_DISPLAY_NAME` → a message on that field. Focus moves to the
  offending field; errors are announced (`role="alert"`).
- A network/500 failure shows a human "couldn't reach the board, try again" — never a raw
  status or stack trace.
- Signed-in state shows the display name and a sign-out control calling
  `DELETE /api/session`.

## Interface contracts

- **Exposes:** `requireSession` and `req.member` — the identity every later mutation stage
  consumes; the join/sign-out UI in the app shell.
- **Consumes:** `contracts/session-cookie-v1.md` (implemented in full),
  `contracts/http-api-v1.md` (`/api/session` routes, `INVALID_TEAM_CODE`,
  `INVALID_DISPLAY_NAME`, `NOT_AUTHENTICATED`), `contracts/persistence-v1.md`
  (`findOrCreateMember`), ADR 0005.

No contract changes. Nothing here is additive to a frozen seam.

## Testing requirements

**Vitest, unit**
- `sign`/`verify` round-trip; tampered payload rejected; tampered signature rejected;
  wrong-secret signature rejected; truncated/one-segment/garbage cookie rejected;
  `issuedAt` older than 30 days rejected.
- `validateDisplayName`: empty, whitespace-only, 1 char, 40 chars, 41 chars, control chars.
- Team-code compare: correct, wrong, empty, and a wrong-length value (must not throw).

**Vitest, integration**
- `POST /api/session` with the wrong code → `401 INVALID_TEAM_CODE`, **no cookie set**.
- Correct code → `201`, cookie present with `HttpOnly` and `SameSite=Lax`; `Secure` present
  under `NODE_ENV=production` and absent otherwise.
- Same display name twice → one Member row, same id, `joinedAt` unchanged.
- `GET /api/session` with no cookie → `401`; with a **hand-forged** cookie (valid shape,
  wrong signature) → `401` and **not** treated as that member. This is the A6 foundation.
- `DELETE /api/session` → `204`, and a subsequent `GET` → `401`.

**Playwright**
- Wrong code → visible polite error, still on the join page (**A2**).
- Correct code + name → signed in, name visible.
- Reload after joining → still signed in.

**UI-smoke asset:** on the live URL, submit a wrong code and expect the visible error;
then join with the real code and expect the signed-in state.

## Acceptance conditions

- [ ] **A2** — a wrong team code is rejected with a visible, polite error and no cookie
- [ ] A forged or tampered cookie is never accepted as a member (foundation for **A6**)
- [ ] Team-code and signature comparisons are timing-safe and cannot throw on odd input
- [ ] `Secure` is set in production and not in development; verified by test
- [ ] Re-joining with the same display name reuses the Member row
- [ ] No secret, and no fragment of `TEAM_CODE`, appears in any response body or log
- [ ] Join is reachable and usable at 375 px wide
- [ ] Additive migration only (no destructive schema change) — expected: **no migration at all**
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — Join is the app's only entry point; a flag that disables it disables
the product. See `feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
