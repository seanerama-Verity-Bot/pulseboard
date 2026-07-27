# 0005. Team-code join with a signed, HTTP-only session cookie

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The spec fixes the access model and leaves the mechanism open:

> One team per deployment. Members join with a **team code** (a single shared invite
> string, set via environment variable). Joining = entering the team code + choosing a
> display name. A session cookie keeps them signed in. No passwords, no accounts beyond
> this.

Two acceptance criteria depend directly on the mechanism:

- **A2** — a wrong team code is rejected with a visible, polite error.
- **A6** — one member cannot edit or delete another member's update, **even via direct
  API calls**. So the identity in the cookie must be unforgeable by the client; a plain
  `memberId=7` cookie would fail A6 against anyone who opens devtools.

Global non-goals forbid OAuth/social login. The spec forbids passwords.

## Decision

**Join** — `POST /api/session` with `{ teamCode, displayName }`:

1. Compare `teamCode` against `process.env.TEAM_CODE` using a **timing-safe** comparison
   (`crypto.timingSafeEqual` over equal-length buffers). Mismatch → `401` with error code
   `INVALID_TEAM_CODE`; the client renders the polite message (A2). The response never
   reveals anything about the expected code, and the same rejection shape is used
   whether the code is wrong, empty, or malformed.
2. Validate `displayName`: trimmed, 1–40 characters after trimming, must contain a
   non-whitespace character. Control characters rejected.
3. Find-or-create the `Member` by a case-insensitive normalized form of the display name,
   so a returning teammate re-joins as themselves rather than accumulating duplicate
   members. `joinedAt` is set on creation only.
4. Issue the session cookie and return the member.

**Session cookie** — name `pb_session`, value `base64url(payload).base64url(hmac)` where
the payload is `{ memberId, displayName, issuedAt }` JSON and the signature is
**HMAC-SHA-256 over the payload bytes** keyed by `SESSION_SECRET`, verified with
`crypto.timingSafeEqual`. Cookie attributes:

| Attribute | Value | Why |
| --- | --- | --- |
| `HttpOnly` | yes | script cannot read or forge it |
| `Secure` | yes in production | the live origin is HTTPS-only (ADR 0004) |
| `SameSite` | `Lax` | same-origin app (ADR 0002); blocks cross-site POSTs |
| `Path` | `/` | |
| `Max-Age` | 30 days | "keeps them signed in"; re-join is cheap if it lapses |

This is a **stateless signed cookie**, not a server-side session store. There is no
session table, nothing to expire on the server, and a restart invalidates nothing —
which is part of what makes A3 (survive a full server restart) hold.

**Authorization** — an `requireSession` middleware verifies the signature, rejects a
missing/invalid/tampered cookie with `401 NOT_AUTHENTICATED`, and attaches
`req.member = { id, displayName }`. **Every mutation derives its actor from
`req.member.id` and never from the request body or a path parameter.** A body field
naming another author is ignored, not honoured. This is the structural half of A6; the
ownership check itself is ADR 0007.

`SESSION_SECRET` is required at boot in production: the server refuses to start if it is
missing or shorter than 32 characters, rather than silently falling back to a default —
a development default that reaches production is a forged-identity bug, not a
convenience.

## Alternatives considered

1. **Server-side session table in SQLite.** Would allow revocation and "who is online".
   Rejected: neither is a spec feature, and it adds a table, a cleanup job, and a
   restart-durability question for zero criterion coverage. A signed cookie is the
   smallest thing that satisfies A6.
2. **JWT via a library.** Functionally equivalent here. Rejected as a dependency and an
   algorithm-confusion surface (`alg: none` and friends) for a token that never leaves
   this origin and needs no interop. A 20-line HMAC helper with a timing-safe compare is
   auditable in full.
3. **`cookie-session` / `express-session` with a store.** Rejected for the same reason as
   (1), plus store configuration on a single-host deployment.
4. **Plain unsigned cookie carrying `memberId`.** Rejected: fails A6 outright.
5. **Rejecting a display name already in use.** Considered, since two people could
   collide. Rejected: with no passwords there is no way to tell a returning member from
   an impostor, and locking a name would let one member permanently deny it to another.
   Find-or-create matches the spec's "no accounts beyond this". The residual risk — a
   teammate could type someone else's name and post as them — is inherent to a
   password-free shared-code design, is noted here deliberately, and is bounded by the
   team code being required to get in at all.

## Consequences

- No session persistence layer; the only auth state is the cookie and `SESSION_SECRET`.
- Rotating `SESSION_SECRET` logs everyone out. That is the intended revocation lever and
  is documented in the README and in SRE's rotation notes.
- `TEAM_CODE` and `SESSION_SECRET` are environment-only, in
  `/etc/pulseboard/pulseboard.env` on the host and GitHub Actions secrets in CI
  (ADR 0004). `.env.example` carries placeholders only.
- Playwright can exercise A6 directly by driving two browser contexts and firing a
  cross-member `PATCH`/`DELETE` at the API with the wrong member's cookie, expecting
  `403`.
- Because `Secure` is set in production, local development over plain HTTP must not set
  it — the cookie helper reads `NODE_ENV`, and this must be tested in both modes or
  local login silently breaks.
