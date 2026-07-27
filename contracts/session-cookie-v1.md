# Contract: session-cookie-v1

- **Status:** frozen v1
- **Owner:** `apps/server` (`src/session/`) — sole producer and sole verifier.
- **Rationale and alternatives:** ADR 0005.

## Exposes

A stateless, signed identity token carried as an HTTP cookie. It is the **only** source
of caller identity in the system. There is no session table, no bearer token, no API key.

Consumers of the identity (the `requireSession` middleware, every mutation route) receive:

```ts
req.member: { id: string; displayName: string }
```

## Consumes

- `SESSION_SECRET` — environment only. The server **refuses to start** in production if
  it is absent or shorter than 32 characters. There is no default value in any
  environment; a dev fallback that reaches production is a forged-identity bug.
- `TEAM_CODE` — environment only; gates issuance, is never stored in the cookie.
- `NODE_ENV` — selects the `Secure` attribute.

## Schema / wire

### Cookie

| Property | Value |
| --- | --- |
| Name | `pb_session` |
| Value | `<payload>.<signature>` — two base64url segments joined by `.` |
| `HttpOnly` | always |
| `Secure` | in production (the live origin is HTTPS-only, ADR 0004); omitted in dev |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Max-Age` | `2592000` (30 days) |

### Payload

`base64url(JSON.stringify(payload))`, where:

```ts
type SessionPayload = {
  memberId: string;     // cuid, the Member.id
  displayName: string;  // denormalized for display without a DB read
  issuedAt: number;     // epoch ms
};
```

Unknown payload keys are ignored on read (forward-compatible). The payload is **signed,
not encrypted** — it is readable by anyone holding the cookie and must therefore never
carry anything secret.

### Signature

`base64url(HMAC_SHA256(key = SESSION_SECRET, message = <payload segment bytes>))`.

The HMAC covers the **encoded payload segment exactly as transmitted**, so verification
never re-serializes JSON (which would make the signature depend on key order).

### Verification (order is normative)

1. Cookie absent, or not exactly two `.`-separated segments → **invalid**.
2. Recompute the HMAC over the payload segment; compare with `crypto.timingSafeEqual`
   after a length check. Mismatch → **invalid**.
3. Parse the payload JSON; a parse failure or a missing/ill-typed `memberId` → **invalid**.
4. `issuedAt` older than 30 days → **invalid** (defence in depth; the cookie's own
   `Max-Age` is client-controlled and therefore not trustworthy on its own).
5. Otherwise **valid**; populate `req.member`.

Invalid on an authenticated route → `401 NOT_AUTHENTICATED` in the `http-api-v1` error
envelope, and the stale cookie is cleared in the response. Invalid is never a 500, and
never leaks which check failed.

### Issuance

Only `POST /api/session` issues a cookie, and only after the team code passes a
timing-safe comparison. No other route sets or refreshes it.

### Trust rules (normative — these are what criterion A6 rests on)

- The actor for any mutation is `req.member.id`. An `authorId`, `memberId`, or
  `displayName` appearing in a request body or query string is **ignored**, never
  honoured.
- The cookie is the only identity input. There is no header-, query-param-, or
  body-based identity override, in any environment, including tests.
- Rotating `SESSION_SECRET` invalidates every outstanding session. That is the intended
  and only revocation mechanism.

## Versioning

Frozen at **v1**. Changes are **additive only** — a breaking change is a NEW
contract, not an edit (framework-spec §4.3). Every consumer depends on this shape.

Additive: new optional payload fields (readers must tolerate their absence). Breaking,
and therefore `session-cookie-v2` with a new cookie name: changing the signing algorithm,
the segment encoding, the signed byte range, the cookie name, or the verification order.
