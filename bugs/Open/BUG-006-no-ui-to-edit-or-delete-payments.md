# BUG-006: No UI to correct or delete a recorded payment

| Field | Value |
|---|---|
| Status | Open (to be revisited by product owner) |
| Severity | Medium |
| Area | Operator / Admin UI |
| Reported | 2026-10-15 |
| Found by | Test planning (feature gap); E2E `billing/record-payment.spec.js` › E16 |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

The backend supports correcting a mis-entered payment
(`PATCH /api/transactions/:id`: amount, discount, mode) and soft-deleting
one (`DELETE /api/transactions/:id`), with full balance and discount
recalculation. Neither operator.html nor admin.html exposes this. When a
payment is mis-keyed, the only options are a whole-bill refund or direct
database edits.

## Steps to reproduce

1. Record a payment of ₹500 when ₹50 was intended.
2. Look for a way to edit or remove it on the operator or admin page.

## Expected

Some way to correct or delete a payment, e.g. an "Edit"/"Delete" action on
a bill's payment ledger, restricted to whichever roles the business decides.

## Actual

None exists. The endpoints are only reachable directly through the API.

## Open questions (for the product owner)

- Who may edit or delete payments: operators (own payments only?), admins,
  or both?
- Should edits be blocked after a day closes, or on refunded bills (see
  BUG-002, which must be fixed first)?
- Should there be an audit view of edits (`updatedById` is already
  recorded)?

## Linked tests

- `e2e/specs/billing/record-payment.spec.js` › `E16: the operator and admin pages offer a way to correct or delete a payment`: `knownBug("BUG-006")`
- The API behaviour itself is covered by E11–E13 (passing) and E14–E15 (BUG-002).
