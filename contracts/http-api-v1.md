# Contract: http-api-v1

- **Status:** frozen v1
- **Owner:** `apps/server` (`src/http/`) — the only producer. Sole consumer: `apps/web`.
- **Types:** declared once in `packages/shared` and imported by both sides (ADR 0003).
  Hand-copied duplicates are a contract violation.

## Exposes

All paths are same-origin under `/api` (ADR 0002). All request and response bodies are
`application/json; charset=utf-8`. All mutations require a valid session cookie
(`session-cookie-v1`); the actor is always taken from that cookie, never from the body.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/session` | none | Join: team code + display name → session |
| `GET` | `/api/session` | optional | Who am I? (session probe on app load) |
| `DELETE` | `/api/session` | session | Leave: clear the cookie |
| `GET` | `/api/board` | session | The whole board, grouped by member, filtered |
| `POST` | `/api/updates` | session | Post an update |
| `PATCH` | `/api/updates/:id` | session | Edit own update within the window |
| `DELETE` | `/api/updates/:id` | session | Delete own update within the window |
| `GET` | `/healthz` | none | Liveness (outside `/api`; no DB write) |

Unmatched `/api/*` routes return a JSON `404` in the error envelope below — **never** the
SPA `index.html` (ADR 0002).

## Consumes

- `session-cookie-v1` — identity for every authenticated route.
- `persistence-v1` — the Member/Update store behind every data-bearing route.
- Environment: `TEAM_CODE`, `SESSION_SECRET`, `APP_TIMEZONE`, `PORT`, `DATABASE_URL`.

## Schema / wire

### Envelope

Success responses are the resource shape directly (no wrapper). **Every** error, at every
status, is exactly:

```ts
type ApiError = {
  error: {
    code: string;      // stable, machine-readable; the client switches on this
    message: string;   // human, polite, safe to show a user verbatim
    field?: string;    // present on validation failures
  };
};
```

No stack traces, no framework HTML error pages, no bare status text — the global Express
error handler guarantees this shape for unhandled throws too (spec quality bar: "no raw
stack traces").

### Shared primitives

```ts
type Mood = 'focused' | 'cruising' | 'blocked' | 'away';   // exactly these four
const MAX_UPDATE_LENGTH = 280;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

type Member = {
  id: string;            // cuid
  displayName: string;   // 1..40 chars, trimmed
  joinedAt: string;      // ISO-8601 UTC, e.g. "2026-07-27T18:25:38.953Z"
};

type Update = {
  id: string;
  authorId: string;
  authorName: string;    // denormalized for rendering; server-supplied
  text: string;          // 1..280 chars
  mood: Mood;
  createdAt: string;     // ISO-8601 UTC
  editedAt: string | null;
  canMutate: boolean;    // server's verdict for THIS requester, right now:
                         // requester is the author AND within EDIT_WINDOW_MS.
                         // A UI convenience only — never the enforcement (ADR 0007).
};
```

All timestamps on the wire are **ISO-8601 UTC with a `Z` suffix**. Day bucketing and
display formatting apply `APP_TIMEZONE` (ADR 0008); the wire never carries local time.

### `POST /api/session`

```jsonc
// request
{ "teamCode": "string", "displayName": "string" }
// 201 -> { "member": Member }
```

Errors: `401 INVALID_TEAM_CODE` (wrong/empty code — criterion A2),
`400 INVALID_DISPLAY_NAME` (`field: "displayName"`).
Sets the `pb_session` cookie on success.

### `GET /api/session`

`200 -> { "member": Member }` when signed in; `401 NOT_AUTHENTICATED` otherwise. The
client uses the 401 as a normal signal to show the join page, not as an error to render.

### `DELETE /api/session`

`204`, clears the cookie. Idempotent.

### `GET /api/board?filter=today|yesterday|all`

`filter` defaults to `all`. An unrecognized value is `400 INVALID_FILTER`.

```jsonc
// 200
{
  "filter": "today",
  "timezone": "Europe/London",        // the APP_TIMEZONE bucketing/display zone (ADR 0008)
  "generatedAt": "2026-07-27T18:25:38.953Z",
  "groups": [
    {
      "member": Member,
      "latestMood": "focused",         // Mood | null — badge; from the member's newest
                                       // update overall, NOT filtered by `filter`
      "updates": [ Update ]            // newest first; may be empty under a filter
    }
  ]
}
```

Ordering is **stable and server-defined**: groups sorted by each member's newest update
`createdAt` descending, then by `displayName` ascending as a tiebreak; members with no
updates at all sort last by `displayName`. Updates within a group are `createdAt`
descending. The client renders the given order and does not re-sort.

`groups: []` and empty `updates` arrays are **normal**, not errors — the client renders
the empty-state copy (feature 6). `Cache-Control: no-store`.

### `POST /api/updates`

```jsonc
// request
{ "text": "string", "mood": "focused" }
// 201 -> { "update": Update }
```

Errors: `400 TEXT_TOO_LONG` (`field: "text"`, > 280 chars after trimming — criterion A7),
`400 TEXT_EMPTY`, `400 INVALID_MOOD`, `401 NOT_AUTHENTICATED`.
Validation is **server-side and authoritative**; the client's character counter is a
courtesy.

### `PATCH /api/updates/:id`

```jsonc
// request — at least one field
{ "text": "string", "mood": "cruising" }
// 200 -> { "update": Update }   // editedAt set
```

Errors, checked in this order (ADR 0007): `401 NOT_AUTHENTICATED`, `404 UPDATE_NOT_FOUND`,
**`403 NOT_AUTHOR`** (criterion A6), **`403 EDIT_WINDOW_EXPIRED`** (criterion A5),
`400 TEXT_TOO_LONG` / `400 TEXT_EMPTY` / `400 INVALID_MOOD`.

### `DELETE /api/updates/:id`

`204` on success. Same error ladder and same order as `PATCH`.

### `GET /healthz`

`200 -> { "status": "ok", "version": "<git sha or package version>" }`. No auth, no DB
write. Used by the deploy script's readiness poll (ADR 0004).

### Error code registry (closed for v1; additions are additive)

`INVALID_TEAM_CODE`, `INVALID_DISPLAY_NAME`, `NOT_AUTHENTICATED`, `NOT_AUTHOR`,
`EDIT_WINDOW_EXPIRED`, `UPDATE_NOT_FOUND`, `TEXT_TOO_LONG`, `TEXT_EMPTY`, `INVALID_MOOD`,
`INVALID_FILTER`, `INTERNAL_ERROR`.

## Versioning

Frozen at **v1**. Changes are **additive only** — a breaking change is a NEW
contract, not an edit (framework-spec §4.3). Every consumer depends on this shape.

Additive means: new endpoints, new **optional** request fields, new response fields, new
error codes. It does **not** mean: renaming or removing a field, changing a type,
changing a status code for an existing condition, tightening validation on an existing
field, or changing the documented ordering. Any of those is `http-api-v2`.
