# BENCHMARK-SPEC.md — Verity Bench v0.1 Build Specification

**This document is the complete and final specification.** If you are an AI agent building one of these apps: this spec overrides your preferences. Where it is silent, make the smallest reasonable decision and record it in an ADR or PR description. Do not add features it doesn't list. Do not substitute technologies it pins. No human is available to ask.

---

## Global Constraints (apply to both apps)

### Tech stack — pinned, no substitutions

- **Language:** TypeScript throughout (strict mode).
- **Backend:** Node 20 + Express. Persistence: SQLite via Prisma. WebSockets (App B): the `ws` library. gRPC (App B): `@grpc/grpc-js` + `@grpc/proto-loader`.
- **Frontend:** React + Vite. Styling: plain CSS or CSS modules — no UI component libraries.
- **Testing:** Vitest for unit/integration; Playwright for end-to-end smoke tests.
- **CI:** GitHub Actions — lint, typecheck, tests must be green to merge.

### Quality bar

- A README that gets a stranger from clone to running locally in ≤ 10 minutes.
- Unit tests for core logic; at least one Playwright smoke test covering the primary user journey; all green in CI.
- No secrets in git, ever. Configuration via environment variables, documented in the README.
- Graceful empty states and error states — no raw stack traces or blank screens in the UI.
- Mobile-responsive layouts (usable at 375 px wide).

### Global non-goals — do not build

Payments, email sending, push notifications, OAuth/social login, admin dashboards, analytics, internationalization, Docker (unless the deployment target requires it), real AI/LLM calls of any kind.

### Deployment

Deploy to the single preconfigured target named **`bench-target`** in the operator's deployment catalog. All services of an app (App B has three) run on that one host. Ports and process management are your decision — record it in an ADR and document it in the README.

### Definition of done

The app's every acceptance criterion below is verified **against the live deployment** (not localhost), and a release is tagged.

---

## App A — Pulseboard

*A small team status board: teammates post short updates; the board shows the whole team at a glance.*

### Users & access

- One team per deployment. Members join with a **team code** (a single shared invite string, set via environment variable).
- Joining = entering the team code + choosing a display name. A session cookie keeps them signed in. No passwords, no accounts beyond this.

### Data model

- **Member** — display name, joined-at.
- **Update** — author, text (≤ 280 chars), mood (one of: `focused`, `cruising`, `blocked`, `away`), created-at, edited-at.

### Features — complete and final

1. **Join:** landing page asks for team code + display name; wrong code shows a clear error.
2. **Post an update:** text + mood picker; posting returns you to the board.
3. **Edit/delete own updates** within 15 minutes of posting; after that they are locked.
4. **Board view:** all members' updates, grouped by member, newest first within each group; each member's latest mood shown as a badge; auto-refreshes within 5 seconds of a new post (polling is acceptable).
5. **Today/Yesterday filter:** toggle the board between updates from today, yesterday, or all.
6. **Empty states:** helpful, human copy when the board or a filter has no updates.

### Acceptance criteria

- **A1.** A first-time visitor holding the team code can join and post an update in under 2 minutes, with no documentation.
- **A2.** A wrong team code is rejected with a visible, polite error.
- **A3.** Updates persist across a full server restart.
- **A4.** A second browser session sees a new update appear within 5 seconds without a manual reload.
- **A5.** Editing is possible at minute 14 and refused at minute 16 (server-enforced, not just hidden in the UI).
- **A6.** One member cannot edit or delete another member's update, even via direct API calls.
- **A7.** Character limit enforced server-side; a 281-character post is rejected cleanly.
- **A8.** Board page Lighthouse performance score ≥ 80 on the live deployment.
- **A9.** The Today/Yesterday filter shows correct results across a date boundary.
- **A10.** The primary journey (join → post → see it on the board) is covered by a passing Playwright test in CI.

### App A non-goals

Multiple teams, direct messages, reactions, file uploads, notification of any kind, user avatars.

---

## App B — Courier

*A PWA chat client and gateway for a personal AI agent that does not exist yet. The agent is mocked; the plumbing — streaming, persistence, auth, protocol contract — is real.*

### Architecture — three components, one repo

1. **Courier Web** — an installable PWA chat interface (React + Vite).
2. **Courier Gateway** — Node service: authentication, conversation persistence, WebSocket streaming to clients, and a gRPC client toward the agent.
3. **Mock Agent** — a separate small gRPC server process implementing the protocol below. It stands in for the future real agent and must be independently start/stoppable.

Client ↔ Gateway: WebSocket (JSON messages). Gateway ↔ Agent: gRPC using this contract, stored at `proto/agent.proto`:

```proto
syntax = "proto3";
package courier.agent.v1;

service Agent {
  rpc Converse (stream ClientEvent) returns (stream AgentEvent);
}

message ClientEvent {
  string conversation_id = 1;
  string text = 2;                 // user's message
}

message AgentEvent {
  string conversation_id = 1;
  oneof event {
    string chunk = 2;              // streamed fragment of the reply
    bool   done = 3;               // reply complete
    string error = 4;              // agent-side failure description
  }
}
```

### Mock Agent behavior — exactly these four modes, selectable per conversation

- **`echo`** — streams the user's message back word by word, ~50 ms between chunks.
- **`scripted`** — cycles through a fixed list of at least 5 canned multi-sentence answers (checked into the repo), streamed chunk by chunk.
- **`slow`** — like `scripted`, but waits 2 s before the first chunk (a "thinking" delay).
- **`fail`** — sends one chunk, then an `error` event, to exercise client error handling.

### Features — complete and final

1. **Accounts:** register + sign in with username and password (hashed at rest); session-based auth; users see only their own conversations.
2. **Conversations:** create, rename, list (most recent first), open; per-conversation mock-mode selector (`echo` / `scripted` / `slow` / `fail`).
3. **Chat:** send a message; the reply **streams into the UI progressively** (chunk by chunk, not all at once); a typing indicator shows while streaming; history loads on open.
4. **Persistence:** all messages stored via the Gateway; full history survives restarts of Gateway, Agent, and browser.
5. **Resilience:** if the WebSocket drops, the client auto-reconnects with backoff and shows a connection status; if the Agent errors or is down, the UI shows a graceful error on that message with a working retry.
6. **PWA:** valid manifest + service worker; the app installs; when offline it opens and shows cached conversation history read-only, with composing clearly disabled.

### Acceptance criteria

- **B1.** In `echo` mode, the first reply chunk renders within 500 ms of send (measured on the live deployment), and the p95 full round trip for a short message is < 1 s.
- **B2.** In `scripted` mode, replies visibly stream progressively and the final text exactly matches the canned script.
- **B3.** Killing the Mock Agent process mid-reply produces a graceful in-UI error on that message; pressing retry after the agent restarts succeeds.
- **B4.** Restarting the Gateway loses no stored messages; reloading the client restores full history.
- **B5.** User 2 cannot access user 1's conversations by ID guessing via API or WebSocket.
- **B6.** The WebSocket reconnects automatically after a network interruption, and the UI reflects the connection state throughout.
- **B7.** Lighthouse PWA audit passes (installable) on the live deployment; performance score ≥ 75.
- **B8.** With the browser offline, the installed app opens and shows previously loaded history; composing is disabled with a clear indicator.
- **B9.** All four mock modes are selectable in the UI and demonstrably behave per their definitions.
- **B10.** The primary journey (register → new conversation → scripted reply streams → reload → history intact) is covered by a passing Playwright test in CI.

### App B non-goals

A real LLM or any external AI API, push notifications, multi-device sync conflict resolution, end-to-end encryption, group conversations, media attachments, native app builds.

---

## Act 2 — "Guide", the drop-in helper bot

*Added only after the MVP is live, as a separate feature request. This section is identical for both apps — the integration constraints are the point of the test.*

### What it is

A self-contained in-app helper: a floating button in the bottom-right corner of every page; clicking it opens a panel where the user types a question about **this app** and gets an instant answer.

### How it answers — no AI, no network calls

- The bot ships with its own knowledge file (JSON or YAML) inside its module, containing **at least 10 question/answer entries specific to this app** (how to join/register, what moods/modes mean, edit time limits, offline behavior, etc. — derived from this spec and the app as built).
- Matching is local keyword/similarity scoring over that file. No external services, no LLM.
- When nothing matches confidently, it says so and points to the README/help — never a wrong answer dressed as a confident one.

### Drop-in integration constraints — hard requirements

- All Guide code, styles, and its knowledge file live in **one directory/module** (e.g., `src/guide/`).
- Mounting it touches the existing app in **at most one import + one mount line** (plus route/asset registration only if the framework strictly requires it). Total changes outside the Guide module: **≤ 10 lines**, and the PR description must include a diff summary proving it.
- No existing test may be modified or deleted; all existing tests still pass.
- Lighthouse performance on existing pages may not regress by more than 5 points.

### Acceptance criteria

- **G1.** The Guide button appears on every page of the app; the panel opens and closes; `Escape` closes it; the whole flow is keyboard-accessible.
- **G2.** The bot correctly answers at least 8 of 10 reasonable app-specific questions drawn from its knowledge file's topics.
- **G3.** An unmatched question produces the honest fallback, not a wrong answer.
- **G4.** The integration constraints above are verifiably met (diff summary in the PR).
- **G5.** All pre-existing acceptance criteria still pass on the live deployment after release.

### Guide non-goals

Chat history, streaming, external calls, per-user personalization, analytics.

---

*Verity Bench v0.1 · This specification is frozen. Changes create v0.2 and results are not comparable across versions.*
