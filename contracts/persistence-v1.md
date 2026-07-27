# Contract: persistence-v1

- **Status:** frozen v1
- **Owner:** `apps/server/src/data/` — the **only** module permitted to import
  `@prisma/client`. Routes and domain logic call repository functions, never Prisma.

## Exposes

The durable store behind the API, and the repository seam over it. Schema lives at
`apps/server/prisma/schema.prisma`; migrations at `apps/server/prisma/migrations/` and
are **committed to git**.

## Consumes

- `DATABASE_URL` — SQLite file URL. In production
  `file:/srv/pulseboard/data/pulseboard.db`, deliberately **outside** the synced release
  directory so a deploy can never clobber it (ADR 0004). This is what makes criterion A3
  — updates persist across a full server restart — structural rather than lucky.

## Schema / wire

### Prisma models

```prisma
model Member {
  id             String   @id @default(cuid())
  displayName    String                      // as typed (trimmed), for display
  normalizedName String   @unique            // lowercased + whitespace-collapsed; the
                                             // find-or-create key (ADR 0005)
  joinedAt       DateTime @default(now())
  updates        Update[]
}

model Update {
  id        String   @id @default(cuid())
  authorId  String
  author    Member   @relation(fields: [authorId], references: [id], onDelete: Cascade)
  text      String                           // 1..280 chars — enforced in domain/, not by SQLite
  mood      String                           // 'focused'|'cruising'|'blocked'|'away'
  createdAt DateTime @default(now())
  editedAt  DateTime?

  @@index([createdAt])
  @@index([authorId, createdAt])
}
```

Notes that are part of the contract, not incidental:

- **All `DateTime` values are UTC instants.** No local time is ever persisted (ADR 0008).
- `mood` is `String` because SQLite has no native enum; the `Mood` union in
  `packages/shared` is the authority and the domain layer validates on the way in.
  Storing a value outside the four moods is a contract violation.
- `text` length is enforced in `domain/`, not by a column type — SQLite would not enforce
  it anyway, and centralizing it keeps criterion A7 to one testable function.
- `normalizedName @unique` is what prevents a returning teammate from accumulating
  duplicate Member rows.
- `onDelete: Cascade` means deleting a Member removes their updates. No route does this
  today; it exists so the constraint is defined rather than discovered.
- The `[authorId, createdAt]` index serves board grouping; `[createdAt]` serves the
  Today/Yesterday range scan (ADR 0008).

### Repository seam

`data/` exports plain-object-returning functions — no Prisma types cross the boundary:

```ts
findOrCreateMember(displayName: string): Promise<MemberRow>
getMemberById(id: string): Promise<MemberRow | null>
listBoard(range: { gte: Date; lt: Date } | null): Promise<{ member: MemberRow; updates: UpdateRow[] }[]>
getLatestMoodByMember(): Promise<Map<string, Mood>>   // unfiltered — the badge ignores the filter
createUpdate(input: { authorId: string; text: string; mood: Mood }): Promise<UpdateRow>
getUpdateById(id: string): Promise<UpdateRow | null>
updateUpdate(id: string, patch: { text?: string; mood?: Mood }): Promise<UpdateRow>  // sets editedAt
deleteUpdate(id: string): Promise<void>
```

`listBoard(null)` is the `all` filter. The `{ gte, lt }` range is computed by the pure
day-boundary function in `domain/` (ADR 0008); `data/` never decides what "today" means.

**Test-only seam:** a `seedUpdate({ ...input, createdAt })` helper accepting an explicit
`createdAt` exists for backdating rows in tests (criteria A5 and A9). It is exported from
a `data/testing.ts` module that no production code path imports, and it is not reachable
from any HTTP route.

### Durability and migrations

- Migrations are applied with `prisma migrate deploy` in the deploy path — never
  `migrate dev`, never `db push` on the host.
- SQLite runs in **WAL mode** (`PRAGMA journal_mode = WAL`), set at startup: better
  concurrent-read behaviour under polling (ADR 0006) and a cleaner crash story.
- One Prisma client instance per process, created once and reused.
- No destructive migration runs without a backup step; SRE owns the backup of
  `/srv/pulseboard/data/`.

## Versioning

Frozen at **v1**. Changes are **additive only** — a breaking change is a NEW
contract, not an edit (framework-spec §4.3). Every consumer depends on this shape.

Additive: new tables, new **nullable** or defaulted columns, new indexes, new repository
functions. Breaking, and therefore `persistence-v2`: dropping or renaming a column or
table, changing a column's type or nullability, changing the meaning of a stored value
(e.g. storing local time in a `DateTime`), or changing a repository function's return
shape.
