# Pulseboard — Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Owned by the **Release/Deploy Operator**,
> updated on every deploy. Records secret **locations** only — never values.

**As of:** 2026-07-27 — planned, not yet deployed

## TL;DR

Identity locked, repo scaffolded, hygiene CI green. Architecture and three frozen contracts
in place. The initial backlog is **8 dependency-ordered stages** (see `stage-instructions/`,
issues #1–#8). `main` is branch-protected. Nothing is built or deployed yet — Stage 1 is
unblocked and next.

Run `verity next` for the current action.

## Live deployment

- (none yet)
- **Target when built:** `bench-target` → `https://bench-target.taile0ffc4.ts.net/`
  (Tailscale Funnel → `127.0.0.1:3001`, systemd unit `pulseboard.service`). ADR 0004.

## Images

- prefix: `ghcr.io/seanerama-Verity-Bot/pulseboard`
- (no releases yet)

## Secrets

Names and locations only. Values live in `/etc/pulseboard/pulseboard.env` on the host
(mode `0640`, owner `bench`) and in GitHub Actions repository secrets.

| Name | Location | Status |
| --- | --- | --- |
| `TEAM_CODE` | host env file; GH Actions secret | not yet set |
| `SESSION_SECRET` | host env file; GH Actions secret (≥ 32 chars) | not yet set |

Non-secret configuration (`DATABASE_URL`, `APP_TIMEZONE`, `PORT`, `NODE_ENV`) is documented
in the README and `.env.example`. Full access notes: `.verity/deploy-access.md` (gitignored,
shared out-of-band).

## Coordination notes

- Branch protection on `main`: PR required, 0 approvals, required checks `structure` +
  `secret-scan`, linear history, no force pushes (ADR 0010).
- **Stage 1 must add `build-and-test` to the required status checks** once its CI job
  exists — the one open item in the gate.
- Stages 5 and 6 are the only pair that may run concurrently; both touch the board
  component.
- Act 2 "Guide" is deliberately not in this backlog — it enters as fresh intake after the
  MVP is live and tagged (ADR 0009).
