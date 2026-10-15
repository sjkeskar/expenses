# BUG-010: Double-clicking Create Bill / Record Payment creates duplicates

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Medium |
| Area | Operator / Admin UI (`public/js/operator.js`, `public/js/admin.js`) |
| Reported | 2026-10-15 |
| Found by | E2E `robustness/security-inputs.spec.js` › K4a, K4b |
| Assignee | — |
| Resolution | Batch 6 of `bugs/FIX-PLAN.md` — `submitOnce()` in `public/js/common.js` disables the submit button for the duration of each Create Bill / Record Payment / Settle request (operator.js and admin.js) |
| Verified by | `robustness/security-inputs.spec.js` › K4a, K4b and the new K4c (Settle) and K4d (button disabled in flight, re-enabled after an error), green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

The submit buttons aren't disabled while a request is in flight, and the
API has no idempotency protection. A double-click (or a second click on a
slow LAN) sends the request twice:

- **Create Bill**: two bills, with two bill numbers consumed and the client's
  outstanding balance doubled.
- **Record Payment**: the payment is recorded twice (as long as the balance
  allows), so the bill is under-collected in reality but shows as paid.

## Steps to reproduce

1. Fill in Create Bill (or Record Payment).
2. Double-click the submit button.

## Expected

Exactly one bill or payment.

## Actual

Two bills, or two payments of the same amount.

## Root cause

The submit handlers in `public/js/operator.js` (`bill-form`,
`transaction-form`, `settle-submit-btn`) and their copies in
`public/js/admin.js` call `api()` without guarding against re-entry.

## Suggested fix

At the start of each handler, disable the submit button (and ignore the
event if it's already disabled); re-enable it in `finally`. Optionally, add
an idempotency key (a client-generated UUID sent with the request) for
`POST /bills`, `/transactions` and `/companies/:id/settle`.

## Linked tests

- `e2e/specs/robustness/security-inputs.spec.js` › `K4a: double-clicking Create Bill creates exactly one bill`: `knownBug("BUG-010")`
- `e2e/specs/robustness/security-inputs.spec.js` › `K4b: double-clicking Record Payment records exactly one payment`: `knownBug("BUG-010")`
