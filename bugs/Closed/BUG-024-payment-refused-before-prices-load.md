# BUG-024: New bill: a payment is called "More than the net amount" when Create bill is pressed before the prices have loaded

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | New bill |
| Reported | 2026-11-10 |
| Found by | E2E `ui/journey-bills.spec.js` › When creating the bill is interrupted |
| Assignee | — |
| Resolution | Fixed 2026-11-10 (uncommitted): the Paid now check runs only once the prices are in (`client/src/features/billing/NewBillPage.tsx`); the server still refuses an overpayment. |
| Verified by | `npm run test:e2e`, 2026-11-10: the linked tests pass as ordinary tests |

## Summary

The "Paid now" check compares against a net amount of zero until the
server's prices arrive. Pressing Create bill in that gap shows "More than
the net amount" for a perfectly correct payment.

## Steps to reproduce

1. On **New bill**, pick the patient and branch and add a test.
2. Straight away type the amount in **Paid now** and press **Create bill**
   (a fast typist, or a slow network: prices come back after a 250 ms pause
   plus the request).

## Expected

No error for a payment that isn't above the net amount: the form waits for
the prices, or checks once they are in.

## Actual

"More than the net amount" appears under Paid now and the bill isn't
created. Pressing Create bill again a moment later works.

## Root cause

`client/src/features/billing/NewBillPage.tsx`: `netPaise` is
`preview ? paise(preview.netAmount) : 0`, and the Paid now validator
rejects `paise(v) > netPaise`. `usePreview` (`features/billing/order.tsx`)
clears the preview while a new one is on its way.

## Suggested fix

Skip the client check while there is no preview (the server refuses an
overpayment anyway), or hold Create bill until the preview has arrived.

## Linked tests

- `e2e/specs/ui/journey-bills.spec.js` › "Create bill pressed before the prices have come back: a payment isn't called 'more than the net amount'"
