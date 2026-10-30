# BUG-006: No UI to correct or delete a recorded payment

| Field | Value |
|---|---|
| Status | Open (to be revisited by product owner) |
| Severity | Medium |
| Area | Bill detail (was: Operator / Admin UI) |
| Reported | 2026-10-15 |
| Found by | Test planning (feature gap); E2E `billing/record-payment.spec.js` › E16 |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Update 2026-10-27 (LMS pivot, Phase 1)

Still open, and still parked for the product owner (`pivot.md` §4.10, §9).
In the new app:

- The endpoints remain: `PATCH /api/transactions/:id` (amount, discount,
  mode) and `DELETE /api/transactions/:id` (soft delete). They lock the bill,
  recompute its totals from its lines, payments and refunds, and route any
  discount change through the discount approval. A cancelled bill's payments
  can't change (its refunds settled it), which is what BUG-002 asked for.
- The **Bill detail** screen lists every payment, settlement and refund, but
  offers no edit or delete. A mis-keyed payment can only be undone by
  cancelling tests (refunding) or through the API.
- The open questions below now read: may technicians correct their own
  payments, or only pathologists or the lead? Should a correction need an
  approval, like discounts? Should a day's payments lock once its day sheet
  is handed over?

No test currently marks this bug: the pre-pivot E16 retired with the old
pages. When it's taken up, add a UI spec on the bill detail screen first.

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
