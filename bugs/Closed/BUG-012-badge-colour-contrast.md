# BUG-012: Status and role badges fail WCAG AA colour contrast

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Medium |
| Area | Shared styles (`public/css/style.css`) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/axe.spec.js` › M2/BUG-012 (axe rule `color-contrast`) |
| Assignee | — |
| Resolution | Batch 7 of `bugs/FIX-PLAN.md` — `.badge.fully_paid` text #256b42 (5.58:1), `.badge.role-admin` text #8a5a12 (5.16:1), and `white-space: nowrap` on `.badge` in `public/css/style.css` |
| Verified by | `accessibility/axe.spec.js` › M2/BUG-012; visual baselines re-recorded and reviewed; green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

Two badge styles don't reach the 4.5:1 contrast ratio that WCAG 2.1 AA
(1.4.3) requires for small text (12px):

| Badge | Text / background | Ratio | Where |
|---|---|---|---|
| `.badge.fully_paid` ("Fully Paid") | #2e7d4f on #e5f2e9 | **4.37:1** | My Bills (operator/admin), client ledger |
| `.badge.role-admin` ("admin") | #c98a2c on #fbeed9 | **2.56:1** | Developer › All Users |

The other badges (pending, refunded, role-operator/developer/accountant)
pass.

A related cosmetic issue, visible in the visual snapshots: in the My Bills
table the "Fully Paid" badge wraps onto two lines because the Status column
is narrow.

## Steps to reproduce

Open My Bills with a fully paid bill, or the Developer page with an admin
user, and measure the contrast (or run the axe test).

## Expected

At least 4.5:1 for badge text.

## Actual

4.37:1 and 2.56:1.

## Root cause

`public/css/style.css:190` (`.badge.fully_paid`) and `:193`
(`.badge.role-admin`, which uses `var(--accent)` as the text colour).

## Suggested fix

Darken the text, e.g. `.fully_paid { color: #256b42 }` and
`.role-admin { color: #8a5a12 }`, then re-check with axe. Add
`white-space: nowrap` to `.badge` to stop the wrap.

## Linked tests

- `e2e/specs/accessibility/axe.spec.js` › `M2/BUG-012: status and role badges meet WCAG AA colour contrast`: `knownBug("BUG-012")`
- After the fix, refresh the visual baselines (`npm run test:e2e:update-snapshots`), since the badge colours appear in them.
