# BUG-002: Editing/deleting a payment on a refunded bill silently un-refunds it

| Field | Value |
|---|---|
| Status | Closed |
| Severity | High |
| Area | Transactions API (`src/routes/transactions.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `billing/record-payment.spec.js` › E14, E15 |
| Assignee | — |
| Resolution | Batch 1 of `bugs/FIX-PLAN.md` — refunded-bill guard in `src/routes/transactions.js` PATCH and DELETE |
| Verified by | `billing/record-payment.spec.js` › E14, E15, green in a full `npm run test:e2e` run on 2026-10-15 |

## Summary

`PATCH /api/transactions/:id` and `DELETE /api/transactions/:id` never check
whether the parent bill is `refunded`. Both recompute the bill's balance and
overwrite its status with `pending` or `fully_paid`. A refunded bill then
comes back to life, with a balance that ignores the refund, while
`refundedAmount`/`refundedAt`/`refundedById` still say it was refunded.
Analytics then counts it as collected or outstanding again.

There's no UI for these endpoints yet (see BUG-006), but any operator
session can call them, and the bug will surface in the UI as soon as an edit
or delete feature is added.

## Steps to reproduce

1. Create a bill for ₹100 with ₹60 collected up front.
2. Refund the bill (status `refunded`, balance 0, refundedAmount 60).
3. `DELETE /api/transactions/<the ₹60 payment id>` (or `PATCH` it to ₹10).

## Expected

`400`: payments on a refunded bill can't be changed. The bill stays
`refunded`.

## Actual

`200`. The bill's status becomes `pending` with a balance of ₹60 (delete) or
₹90 (edit), and the refund fields are left behind.

## Root cause

- `src/routes/transactions.js:126` (PATCH) and `:215` (DELETE) load the bill,
  but have no `bill.status === "refunded"` guard.
- `:194` / `:241` unconditionally set `status` from the recomputed balance.

## Suggested fix

In both handlers, inside the DB transaction:
`if (bill.status === "refunded") throw { status: 400, message: "This bill has been refunded; its payments can no longer be changed." }`.

## Linked tests

- `e2e/specs/billing/record-payment.spec.js` › `E14: deleting a payment on a refunded bill…`: `knownBug("BUG-002")`
- `e2e/specs/billing/record-payment.spec.js` › `E15: editing a payment on a refunded bill…`: `knownBug("BUG-002")`
