# Stage 8: Acceptance hardening — full Playwright journey, Lighthouse, live verification

- **Type:** chore
- **Depends on:** 7

## Objectives

Close the spec's definition of done:

> The app's every acceptance criterion is verified **against the live deployment** (not
> localhost), and a release is tagged.

Earlier stages each proved their own criterion. This stage proves **all ten together, on
the live URL**, and produces the evidence. It builds no new feature; if it finds a gap, the
gap is fixed here or filed as a bug stage.

## What to build

### 1. The A1–A10 verification matrix

`docs/acceptance.md` — one row per criterion: how it is verified, where the automated proof
lives, and (filled in on execution) the result against
`https://bench-target.taile0ffc4.ts.net/`.

| | Criterion | How it is proven |
| --- | --- | --- |
| A1 | join + post in < 2 min, no docs | Timed Playwright journey against the live URL, no docs consulted |
| A2 | wrong code → polite error | Playwright, live |
| A3 | survives full server restart | Post live → `sudo systemctl restart pulseboard` → reload → present |
| A4 | second session sees it in < 5 s | Two live browser contexts, 5000 ms budget |
| A5 | editable at 14 min, refused at 16 | Unit + integration on the pure function; live API check with a backdated seed |
| A6 | no cross-member mutation via API | Live direct `PATCH`/`DELETE` with the wrong member's cookie → 403 |
| A7 | 281 chars rejected server-side | Live `curl`/API call → 400 `TEXT_TOO_LONG`, no row |
| A8 | Lighthouse performance ≥ 80 | Lighthouse against the live board page |
| A9 | filter correct across a date boundary | Unit table (non-UTC + DST) + live filter check with a backdated seed |
| A10 | primary journey in Playwright, in CI | The CI e2e job |

### 2. Full primary-journey e2e

Consolidate the journey into one authoritative spec: join → post → see it on the board →
edit → filter → sign out. It runs in CI against a locally built app (that is **A10**) and
is runnable against the live URL via a `BASE_URL` environment variable. Same spec, two
targets — no drift between what CI proves and what the live check proves.

### 3. Lighthouse (A8)

- Run Lighthouse against the **live** board page, mobile and desktop, with data present
  (an empty board is not a representative measurement).
- Record the numeric performance score in `docs/acceptance.md`; **≥ 80** is the bar.
- If it falls short, fix within the pins — check compression is actually applied to
  responses, asset cache headers are correct (ADR 0002), the bundle has no stray
  dependency, images (if any) are sized, and there is no render-blocking work. Do **not**
  reach for a new framework or library.
- Also record the accessibility and best-practices scores as context, though only
  performance is a criterion.

### 4. Live verification pass

Run the whole matrix against the public HTTPS URL and record actual results — pass/fail
with evidence, not assertions of confidence. A criterion verified only on localhost is
**not** verified.

The A3 restart and the A6 direct-API checks in particular must be executed against the live
host, since both are exactly the kind of thing that behaves differently there.

### 5. Release

- Confirm the README still gets a stranger from clone to running in ≤ 10 minutes — actually
  follow it from a clean clone and time it.
- Confirm `.env.example` documents every variable the app reads, and that no secret is in
  git anywhere in history.
- Update `STATUS.md` with the deployed version and environment.
- Tag the release (`/verity:ship` owns the mechanics).

## Interface contracts

- **Exposes:** `docs/acceptance.md` (the evidence record) and the consolidated journey spec.
- **Consumes:** every frozen contract, as a verification target. **No contract may change in
  this stage** — a contract change here would mean an earlier stage shipped against the
  wrong shape, which is a bug stage, not a hardening edit.

## Testing requirements

- The consolidated primary-journey Playwright spec, green in CI (**A10**).
- The live run of that spec against `BASE_URL=https://bench-target.taile0ffc4.ts.net/`.
- The live A3 restart check, scripted and repeatable.
- The live A6 direct-API check — two real sessions, cross-member `PATCH` and `DELETE`, both
  expecting `403`.
- The live A7 check — a 281-character post rejected with `TEXT_TOO_LONG`.
- The Lighthouse run, with the score recorded.
- The full UI-smoke asset set from Stages 1–7, run against the live URL.

## Acceptance conditions

- [ ] `docs/acceptance.md` exists with all ten criteria, each marked verified **against the
      live deployment**, with evidence
- [ ] **A8** — Lighthouse performance on the live board page is **≥ 80**; the number is recorded
- [ ] **A10** — the primary journey passes in CI
- [ ] The same journey spec passes against the live URL via `BASE_URL`
- [ ] **A3** verified live by an actual `systemctl restart`
- [ ] **A6** verified live by direct API calls, not only through the UI
- [ ] **A7** verified live
- [ ] README walked from a clean clone in ≤ 10 minutes
- [ ] `.env.example` covers every variable read by the app
- [ ] No secret anywhere in git history (`secret-scan` green over full history)
- [ ] `STATUS.md` updated; release tagged
- [ ] No contract changed in this stage
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — verification stage, no net-new feature. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: YES

This stage exercises the release and deploy path end to end and produces the evidence that
the definition of done is met.
