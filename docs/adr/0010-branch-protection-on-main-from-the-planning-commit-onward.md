# 0010. Branch protection on main from the planning commit onward

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Per framework-spec §3, the bootstrap commit is the only one that lands before branch
protection. In this session the Vision, Architect and Planner roles each landed a commit
on `main` directly:

1. `01bf0a3` — bootstrap scaffold (the sanctioned pre-protection commit)
2. `5ca24eb` — ADRs, frozen contracts, architecture
3. `79fe5f2` — the stage backlog and feature assessment

Commits 2 and 3 are **intent artifacts** — documents that define what will be built. They
are the Architect's and Planner's normal write path, and there was no code, no test and no
deployable behaviour to gate. Protecting `main` before them would have meant opening PRs
against a repository whose review criteria did not yet exist.

From Stage 1 onward, every commit is code. A headless worker builds the stages, so the gate
has to be enforced by the platform rather than by an agent's good intentions.

## Decision

Enable branch protection on `main` immediately after the planning commit, before any code
stage begins:

| Setting | Value | Why |
| --- | --- | --- |
| Require a pull request | yes | Every code change is reviewable; `/verity:review` is the integration gate |
| Required approving reviews | **0** | The Reviewer role is the approval; a human-approval requirement would deadlock headless operation |
| Dismiss stale reviews | yes | A new push invalidates a prior approval |
| Required status checks | `structure`, `secret-scan` | The two jobs that exist today and run on `pull_request` |
| Strict (branch up to date) | yes | A PR is tested against current `main`, not a stale base |
| Required linear history | yes | Squash/rebase only; readable history, bisectable |
| Required conversation resolution | yes | Review findings cannot be merged past silently |
| Force pushes / deletions | blocked | `main` history is immutable |
| Enforce for admins | **no** | See below |

**Follow-up, owned by Stage 1:** once Stage 1's CI adds the `build-and-test` job, add it to
the required-status-check contexts. It is deliberately not required today — requiring a
check that no workflow produces would block every PR indefinitely. This is written into
Stage 1's acceptance conditions (keep `structure` and `secret-scan`, add
`build-and-test`), so the gate tightens as soon as there is something to tighten it around.

## Alternatives considered

1. **Protect `main` before the Architect and Planner commits.** The most literal reading of
   §3. Rejected: it would have routed pure-documentation commits through a review gate whose
   contracts and stage specs those very commits create. The spirit of §3 is that *code*
   never reaches `main` ungated, and no code has reached `main`.
2. **Require ≥ 1 approving review.** Correct for a human team. Rejected here: the operator
   is explicitly running headless with no human available, and GitHub does not count a
   PR author's own approval. Requiring one would halt the build at Stage 1's PR. The
   Reviewer role (`/verity:review`) supplies adversarial review; branch protection supplies
   the mechanical gate.
3. **`enforce_admins: true`.** Stronger, and tempting. Rejected: the worker and the Reviewer
   operate with admin rights, and a locked-out admin in an unattended run is an unrecoverable
   stall rather than a safety property. The protections that actually prevent history loss —
   no force pushes, no deletions, linear history — apply regardless.
4. **Requiring `build-and-test` immediately.** Rejected: the job does not exist yet, so
   every PR would sit forever on a pending check. Scheduled as a Stage 1 follow-up instead.

## Consequences

- From Stage 1 on, every change reaches `main` through a PR with green `structure` and
  `secret-scan`, up to date with `main`, with conversations resolved.
- `main`'s history cannot be rewritten or deleted, by anyone.
- Until Stage 1 lands, the required checks are hygiene-only. The window is exactly one PR
  wide, and closing it is an explicit acceptance condition of that PR.
- Admins can merge without the PR flow. That is a deliberate escape hatch for an unattended
  run, and it is visible in the audit trail — a direct push to `main` after this ADR is a
  reviewable anomaly, not a permitted shortcut.
