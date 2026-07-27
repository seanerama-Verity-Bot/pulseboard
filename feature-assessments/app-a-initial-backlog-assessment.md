# Feature assessment — App A (Pulseboard) initial backlog

- **Date:** 2026-07-27
- **Mode:** A (initial decomposition)
- **Request source:** `docs/benchmark-spec.md`, Section "App A — Pulseboard" + Global
  Constraints, via the operator's session instruction.
- **Decision:** **ACCEPT and SPLIT** into 8 dependency-ordered stages.
- **Autonomy note:** run headless, no human available. Every judgment call below is
  recorded here or in an ADR rather than asked.

## Verification against the live codebase

The planner must not build on false premises. The repository at the time of planning:

| Claim the plan relies on | Reality | Verified how |
| --- | --- | --- |
| Repo is scaffolded, hygiene CI green on `main` | true — run `30293749296` succeeded | `gh run list` |
| Identity locked as `pulseboard` / `seanerama-Verity-Bot` | true | `verity identity get` |
| Deployment catalog has exactly one configured target, `bench-target` | true; `hasConfigured: true` | `verity deployment list` / `show` |
| Three contracts frozen | true — `http-api-v1`, `session-cookie-v1`, `persistence-v1` | `verity contract list` |
| ADRs 0001–0009 exist and are Accepted | true | `docs/adr/` |
| **No stages exist yet** | true — `{"stages":[]}` | `verity stage list` |
| **No application source code exists yet** | true — repo contains docs, contracts, CI, scaffold files only | `ls -R`, `git log` |
| Spec is committed for every role to reference | true — `docs/benchmark-spec.md` | `git show --stat` |

Consequence of the last two: this is a **greenfield** decomposition. Nothing in the backlog
may assume an existing module, and Stage 1 must create everything the later stages import.
Stage specs are written accordingly — each names the files it creates rather than referring
vaguely to "the existing server".

## Contract-safety analysis

| Stage | Touches a frozen contract? | Verdict |
| --- | --- | --- |
| 1 | Implements all three for the first time | Not a change — first implementation |
| 2 | `session-cookie-v1` in full; `/api/session` routes | Additive; no shape change |
| 3 | `POST /api/updates` | Already in `http-api-v1`; additive |
| 4 | `GET /api/board` (`filter=all`) | Already in `http-api-v1`; additive |
| 5 | `PATCH`/`DELETE /api/updates/:id` | Already in `http-api-v1`; additive |
| 6 | `filter=today\|yesterday` | Values the contract already names; additive |
| 7 | Consumes the error-code registry; no server change | No contract impact |
| 8 | Verification only | **No contract may change** |

**No new contract is needed and no frozen contract is threatened.** The three contracts
were written to cover the whole App A feature list, so every stage implements a shape that
is already frozen rather than negotiating a new one. That is the intended effect of
contracts-first: later stages extend without re-litigating the core.

`INVALID_FILTER` is deliberately implemented in Stage 4, before Stage 6 needs it, so
Stage 6 adds only values and not error handling.

## Stage list and dependency order

```
1  Walking skeleton                (chore)   blocks everything
   └─ 2  Join                      (feature)
      └─ 3  Post an update         (feature)
         └─ 4  Board view          (feature)
            ├─ 5  Edit / delete    (feature)
            └─ 6  Today/Yesterday  (feature)
               └─ 7  Empty, error, responsive polish   (feature, depends 5 + 6)
                  └─ 8  Acceptance hardening + release (chore)
```

Stages 5 and 6 are the only pair that may run concurrently; both extend the board component
and will need a small merge.

**Why this order.** Each stage is the thinnest slice that is demonstrable on its own. Join
before Post because posting needs an author; Post before Board because a board of nothing
proves nothing; Edit and Filter after the board because both are board behaviours. Polish
after both, because consistent empty and error states can only be written once every
surface exists. Verification last, because the definition of done is "all ten criteria on
the live deployment".

## Criterion coverage — nothing orphaned

| Criterion | Stage |
| --- | --- |
| A1 join + post < 2 min | 2, 3 (verified live in 8) |
| A2 wrong code → polite error | 2 |
| A3 survives restart | 1 (DB path), 3 (verified), 8 (live) |
| A4 second session < 5 s | 4 |
| A5 edit at 14, refused at 16 | 5 |
| A6 no cross-member mutation | 2 (unforgeable identity), 5 (enforcement) |
| A7 281 chars rejected | 3 |
| A8 Lighthouse ≥ 80 | 1 (budget), 7 (protect), 8 (measure) |
| A9 filter across a date boundary | 6 |
| A10 journey in Playwright, in CI | 4 (first pass), 8 (consolidated) |

Every spec feature 1–6 maps to a stage: 1→S2, 2→S3, 3→S5, 4→S4, 5→S6, 6→S7.

## Judgment calls made without a human

1. **Kill-switches are N/A for stages 1–8.** The stage template pre-fills "kill-switch /
   dark-launch flag (default OFF) for this net-new feature". That control exists to let a
   risky addition ship dark alongside working behaviour. In this backlog there *is* no
   prior behaviour: stages 1–7 collectively **are** the MVP, and a flag defaulting OFF
   would ship an app whose only door is closed. Each stage records N/A with its reason
   rather than adding a dead flag, and reviewers should read the omission as deliberate.
   The convention resumes for genuinely post-MVP additions — the Act 2 Guide, when it
   arrives, ships behind a flag.

2. **The full database schema lands in Stage 1**, not incrementally. `persistence-v1`
   already froze both models; spreading them across stages would mean five migrations for a
   two-table schema and would make every feature stage a migration stage. Later stages are
   expected to add **no migration at all**, which is stated in their acceptance conditions
   so a stray migration is visible as a smell.

3. **`INVALID_FILTER` in Stage 4, before it is needed.** See contract analysis above.

4. **Character counting by Unicode code point** (Stage 3). The spec says "≤ 280 chars"
   without defining a character. `String.length` counts UTF-16 units, so a post of 280
   emoji would be rejected while the UI counter said it was fine. Code points are the
   reading a user would recognize; the client and server must agree, and both are tested.

5. **Stage 8 exists as its own stage** rather than folding verification into Stage 7. The
   definition of done is explicitly "verified against the live deployment", which is work
   with its own failure modes (Lighthouse shortfall, live-only A3/A6 behaviour). Giving it
   a stage means a shortfall is a visible, fixable unit rather than a footnote on a polish
   PR.

6. **A6 is tested at the API layer, not only through the UI.** The criterion says "even via
   direct API calls", so a UI-only test would not prove it. Stages 2, 5 and 8 each assert
   at the API.

7. **No Act 2 Guide stages, and no catalog `helper-bot` stages.** ADR 0009 — the spec gates
   Guide behind a live MVP, and the catalog feature requires an LLM the global non-goals
   forbid. Guide enters as fresh intake after Stage 8 tags a release.

## Deferred / rejected

| Item | Verdict | Why |
| --- | --- | --- |
| Catalog `helper-bot` | **REJECT** | Needs a chat/LLM loop; global non-goals forbid AI calls. ADR 0009 |
| Act 2 "Guide" | **DEFER** | Spec: "added only after the MVP is live". New intake after Stage 8 |
| WebSockets / SSE for the board | **REJECT** | Spec blesses polling for App A; ADR 0006 |
| `ETag` conditional polling | **DEFER** | Pure optimization, contract-compatible, not needed at this size. ADR 0006 |
| Multiple teams, DMs, reactions, uploads, notifications, avatars | **REJECT** | App A non-goals |
| Payments, email, push, OAuth, admin, analytics, i18n, Docker | **REJECT** | Global non-goals |
| Per-member timezone preference | **REJECT** | Not in the Member model; ADR 0008 |
| Rejecting an in-use display name | **REJECT** | No passwords means no way to distinguish a return from an impostor; ADR 0005 |

## Handoff

Each stage has a GitHub work-item issue (`[stage N] <title>`, labelled by type) linked to
its instruction file. A headless worker builds them in dependency order via `/verity:build`,
one PR per stage, reviewed and merged by `/verity:review`. This session plans only; it
builds nothing.
