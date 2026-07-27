# Stage 7: Empty states, error states, and mobile-responsive polish

- **Type:** feature
- **Depends on:** 5, 6

## Objectives

Spec feature 6 (helpful, human copy when the board or a filter has no updates) plus the
Global Constraints quality bar that no earlier stage owns end to end:

> Graceful empty states and error states — no raw stack traces or blank screens in the UI.
> Mobile-responsive layouts (usable at 375 px wide).

Earlier stages each handled their own local cases; this stage makes the whole surface
consistent and sweeps what fell between them. It also protects **A8** ahead of Stage 8's
measurement.

## What to build

### Empty states — every one, with copy written for a human

| Situation | Requirement |
| --- | --- |
| Board with no members at all | Welcoming: nobody has posted yet, here's how to be first. Offers the composer. |
| Board with members but no updates in **All** | Distinct from the above — the team is here, the board is quiet. |
| **Today** filter empty | Says so in terms of today, and points at Yesterday or All rather than dead-ending. |
| **Yesterday** filter empty | Same shape, its own copy. |
| A member with no updates in the selected range | A short per-group line, not an empty gap that reads as a rendering bug. |
| First load, before data arrives | A loading state that is not a blank screen and does not flash for fast responses. |

Each is genuinely different copy. Reusing one string for all six fails "helpful, human".
No dead ends: every empty state offers the next action.

### Error states — a single consistent pattern

- One error-presentation component used everywhere, taking an `error.code` and rendering
  the human message for it. Every code in the `http-api-v1` registry has copy:
  `INVALID_TEAM_CODE`, `INVALID_DISPLAY_NAME`, `NOT_AUTHENTICATED`, `NOT_AUTHOR`,
  `EDIT_WINDOW_EXPIRED`, `UPDATE_NOT_FOUND`, `TEXT_TOO_LONG`, `TEXT_EMPTY`, `INVALID_MOOD`,
  `INVALID_FILTER`, `INTERNAL_ERROR`, plus an unknown-code fallback that is still polite.
- A **React error boundary** at the app shell: a render crash shows a human "something went
  wrong" panel with a reload action — never a white screen, never a component stack.
- A non-JSON or malformed response (e.g. an HTML error page from an upstream hiccup) is
  caught and shown as a friendly failure, not a JSON parse exception in the console with a
  blank page behind it.
- Session expiry mid-session returns the user to the join view with an explanation, not a
  silent failure or a redirect loop.
- Confirm the audit from Stage 1 still holds: **no server response body anywhere contains a
  stack trace**, including the 500 path.

### Mobile responsive — usable at 375 px

- Verify every surface at **375 px**: join, composer, board, filter toggle, inline edit,
  every empty state, every error state.
- No horizontal scrolling. Touch targets ≥ 44 px. Text does not clip or overlap. Long
  display names and long unbroken update text wrap rather than overflow (`overflow-wrap`).
- The filter toggle and mood picker stay usable at that width — they are the two most
  likely to break.
- A Playwright viewport project at 375×667 runs the smoke journey.

### Accessibility and A8 protection

- Landmarks (`header`, `main`), a sensible heading hierarchy, focus visible on every
  interactive element, a skip link if the header grows.
- Form fields have real labels; errors are associated with their field and announced.
- Colour contrast meets WCAG AA. Mood badges remain distinguishable without colour.
- No layout shift from the mood badges or the poll refresh (CLS is an A8 input).
- `<title>`, `<meta name="description">`, and `<meta name="viewport">` present and correct.
- Audit the bundle: still no UI component library, no CSS framework, no icon font, no date
  library. Fonts are system stacks — no webfont download.

## Interface contracts

- **Exposes:** the shared error-presentation component and the empty-state set, consumed by
  any later feature.
- **Consumes:** `contracts/http-api-v1.md` (the closed error-code registry — every code must
  have copy). No server behaviour changes; this stage is client-side plus a verification
  pass over the server's error envelope.

No contract changes.

## Testing requirements

**Vitest, component**
- Each of the six empty states renders its own distinct copy for its own condition. A test
  asserting the strings differ from one another catches copy-paste reuse.
- The error component renders a specific human message for **every** code in the registry,
  and a polite fallback for an unknown code. Drive this from the registry list so a future
  code addition fails the test until copy exists.
- The error boundary catches a thrown render error and shows the panel.
- A malformed/non-JSON response produces the friendly failure, not an unhandled rejection.

**Playwright**
- A 375×667 viewport project runs join → post → board and asserts no horizontal overflow
  (`document.documentElement.scrollWidth <= clientWidth`).
- Empty-board state renders its copy on a fresh database.
- Today filter with no updates today renders its own copy and offers a way onward.
- An `EDIT_WINDOW_EXPIRED` response (via a backdated seeded update) renders its specific
  message, not a generic one.

**UI-smoke asset:** on the live URL at 375 px, load the board, switch to a filter with no
updates, and expect the empty-state copy — not a blank region.

## Acceptance conditions

- [ ] All six empty states exist with distinct, human, non-dead-end copy
- [ ] Every `http-api-v1` error code has its own human message; unknown codes degrade politely
- [ ] An error boundary prevents any white screen; no component stack ever reaches the user
- [ ] No response body contains a stack trace, including the 500 path
- [ ] Session expiry returns the user to join with an explanation
- [ ] Every surface usable at 375 px with no horizontal scroll; touch targets ≥ 44 px
- [ ] Long names and long unbroken text wrap rather than overflow
- [ ] WCAG AA contrast; mood badges distinguishable without colour; focus always visible
- [ ] No layout shift from badges or the poll refresh
- [ ] Bundle audit: no component library, CSS framework, icon font, date library, or webfont
- [ ] Additive migration only — expected: **no migration at all**
- [ ] Existing suite stays green; CI all-green

**Kill-switch:** N/A — this hardens existing surfaces rather than adding a net-new one. See
`feature-assessments/app-a-initial-backlog-assessment.md`.

## Pipeline test: NO
