# BUG-009: Combobox list vanishes when a field is re-focused within 150 ms

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Shared UI (`public/js/common.js`, `attachCombobox`) |
| Reported | 2026-10-15 |
| Found by | E2E flakiness investigation (create-bill D2) |
| Assignee | — |
| Resolution | Batch 4 of `bugs/FIX-PLAN.md` — `attachCombobox()` in `public/js/common.js` stores the blur timer, cancels it on focus/input, re-checks focus before hiding, and hides immediately on Tab |
| Verified by | new `accessibility/keyboard.spec.js` › M3j; the retry in `Combobox.pick()` and the `toPass` in admin-tabs H5 were removed and the suite stayed green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

When a combobox input loses focus, it schedules a 150 ms timer that hides
its suggestion list. The timer is never cancelled. If the same field is
focused again before the timer fires and the list opens, the old timer hides
the new list. The user's typing then shows no suggestions until they type
again.

Fast keyboard users can hit this (Tab out, Shift+Tab back), as can anyone
re-opening a field right after picking from it. It made the E2E tests flaky
until `Combobox.pick()` in `e2e/pages/components.js` started retrying.

A second effect of the same lingering timer: while the hidden-on-a-timer list
is still visible, it's scrollable (`overflow-y: auto`), so Chrome makes it a
**Tab stop**. A fast keyboard user tabbing through Create Bill can land on
the category list instead of the Create Bill button (seen in
`accessibility/keyboard.spec.js` › M3b, which now tabs at a human pace).

## Steps to reproduce

1. In Create Bill, pick a category from the list. The input blurs and the
   timer starts.
2. Within 150 ms, focus the category field again and type. (Easiest to see
   when automated: submit a bill, then immediately start the next one.)

## Expected

The suggestion list stays open while the field has focus.

## Actual

The list appears, then disappears about 150 ms after the earlier blur.

## Root cause

`public/js/common.js:197`: `setTimeout(() => { dropdown.style.display = "none"; … }, 150)`
in the blur handler. The timer id isn't stored, and the focus handler at
`:191` doesn't clear it.

## Suggested fix

Store the id (`let hideTimer`), call `clearTimeout(hideTimer)` in the focus
and input handlers, and/or check `document.activeElement !== input` inside
the callback before hiding. Hide the list immediately when a Tab moves focus
away (the delay is only needed for mouse clicks on a suggestion), or give
the list `tabindex="-1"`.

## Linked tests

No dedicated expected-failure test (it's a timing race). Once it's fixed,
remove the retry in `Combobox.pick()` (`e2e/pages/components.js`) and the
`toPass` in admin-tabs H5. Then run
`npx playwright test --repeat-each=5 e2e/specs/billing/create-bill.spec.js`
to confirm.
