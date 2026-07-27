# 0009. Decline the catalog helper-bot; Act 2 "Guide" is deferred until after MVP go-live

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The Architect role offers the drop-in feature catalog. It currently contains one entry:

- **`helper-bot` — In-App Help Agent**: a restricted mode of *the app's own chat loop*,
  backed by an isolated read-only tool registry, structured JSON logs the agent can
  query, a baked source snapshot, GitHub issue drafting, and an accreting FAQ.

Separately, `docs/benchmark-spec.md` has an **Act 2 — "Guide"** section describing a
superficially similar but materially different thing: a floating help button whose
answers come from a checked-in knowledge file scored by **local keyword matching**, with
**no AI and no network calls**, confined to one module with a ≤ 10-line integration
budget outside it.

The operator's instruction for this session is unambiguous about scope:

> Build exactly what Section "App A — Pulseboard" describes: its feature list is
> complete and final, and its acceptance criteria are the definition of done.

And the spec itself scopes Act 2:

> Added **only after the MVP is live**, as a separate feature request.

## Decision

1. **Decline the catalog `helper-bot` feature outright** — now and later. It does not
   fit this project on three independent counts:
   - It presumes the app has a chat/LLM loop. Pulseboard has no chat loop and never will;
     its feature list is closed.
   - Its answers come from an LLM. The global non-goals forbid "real AI/LLM calls of any
     kind", and Act 2 forbids them again for the Guide specifically.
   - Its recipe injects six stages (structured logging, source-snapshot bake, help UI,
     agent + tool registry, GitHub issue endpoint, FAQ job), none of which any App A
     acceptance criterion covers. Adding them would be adding features the spec does not
     list — the exact thing the spec forbids.
2. **Do not plan Act 2 "Guide" stages in the initial backlog.** The spec gates it behind
   a live MVP and frames it as a separate feature request. It enters through
   `/verity:plan` as new intake *after* Pulseboard's A1–A10 are verified against the live
   deployment and a release is tagged — not before.
3. **Record what Act 2 will need, so today's decisions do not block it.** When Guide is
   requested, it must mount with ≤ 10 lines of change outside its own module (G4). Two
   cheap, non-speculative properties of the current design keep that achievable, and
   neither is built for Guide's sake:
   - The web app has a single app-shell component that wraps every route (already
     required to render the header and the filter chrome), so a future mount is one
     import plus one element.
   - `apps/web` is a workspace (ADR 0003), so a `src/guide/` module drops in without a
     structural change.

   No Guide code, stub, directory, feature flag, or knowledge file is created now. A
   placeholder would be dead code carrying an unverified promise.

## Alternatives considered

1. **Accept `helper-bot` and adapt it to the no-AI rule.** Rejected: strip the LLM, the
   log-querying tools, the issue drafting and the FAQ job, and nothing of the catalog
   feature remains. It would be Act 2 wearing the catalog's name, planned before the
   spec permits it.
2. **Build Act 2 "Guide" now, alongside the MVP.** Tempting for throughput, and the
   module is self-contained. Rejected: the spec sequences it explicitly ("only after the
   MVP is live"), G5 requires all pre-existing criteria to still pass on the live
   deployment *after* the Guide release — which presupposes they passed before it — and
   G4's diff-summary proof is only meaningful against a settled codebase.
3. **Scaffold an empty `src/guide/` now to reserve the seam.** Rejected: an empty module
   is untested, unreferenced, and would still need rewriting when the real requirements
   arrive. The workspace layout already makes it a zero-friction addition.

## Consequences

- The initial backlog contains **no** help-bot or Guide stages. The stage list is exactly
  the App A walking skeleton plus its six features plus a hardening/live-verification
  stage.
- When Act 2 arrives it is fresh intake through `/verity:plan`, with its own stage spec,
  its own contract (a Guide module boundary — none is frozen today), and its own ADR
  covering the matching algorithm and the knowledge-file format.
- G4's "≤ 10 lines outside the module" is credible because the app shell exists as a
  single mount point. This is stated as a consequence of the current design, not as work
  performed in advance.
- If the catalog later gains a feature that does fit an App A-shaped project, it gets its
  own ADR; this one closes only `helper-bot`.
