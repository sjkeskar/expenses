# BUG-016: The intended keyboard focus ring for inputs and selects is overridden

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Shared styles (`public/css/style.css`) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/keyboard.spec.js` › M3g |
| Assignee | — |
| Resolution | Batch 7 of `bugs/FIX-PLAN.md` — the `input:focus, select:focus` rule in `public/css/style.css` is scoped to `:not(:focus-visible)`, so keyboard focus gets the intended 2px ring |
| Verified by | `accessibility/keyboard.spec.js` › M3g, green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

`style.css` deliberately defines a strong focus ring for keyboard users on
`button`, `input` and `select`. The comment calls out how much this matters
for keyboard-only operators. But a later rule, `input:focus, select:focus { outline: none; … }`,
has the same specificity and comes later in the file, so for **inputs and
selects** the ring is removed. They show only a border-colour change and a
3px shadow at **12% opacity**, which is very hard to see. Buttons are
unaffected (they keep the 2px outline).

## Steps to reproduce

Tab through the Create Bill form and watch for the focus indicator on the
text fields and selects.

## Expected

A 2px solid `--primary-dark` outline with a 2px offset, as the comment
intends.

## Actual

`outline: none`; only a subtle border/shadow change.

## Root cause

`public/css/style.css:69-74` (intended `:focus-visible` ring) is overridden
by `public/css/style.css:146-150` (`input:focus, select:focus { outline: none; … }`).

## Suggested fix

Drop `outline: none` from the `:focus` rule, or move the `:focus-visible`
block below it. Keep the soft shadow for mouse focus if wanted.

## Linked tests

- `e2e/specs/accessibility/keyboard.spec.js` › `M3g: inputs and selects show the explicit 2px keyboard focus ring`: `knownBug("BUG-016")`
- After the fix, refresh the visual baselines: focused fields appear in `operator-combobox`.
