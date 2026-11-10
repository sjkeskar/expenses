# BUG-023: No way to enter when a sample was actually collected

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Medium |
| Area | Bill detail, Sample revisits |
| Reported | 2026-11-10 |
| Found by | Product owner, during the UI scenario review |
| Assignee | — |
| Resolution | Fixed 2026-11-10 (uncommitted): the Mark collected confirmation on the bill and on Sample revisits has a "Collected at" time (`client/src/features/billing/CollectedAt.tsx`), empty meaning now; the server refuses a time more than 5 minutes ahead (`collectSamples` in `src/services/billing.js`). The new-bill form is unchanged: a sample left on "Collected now" is still stamped with the bill's time. |
| Verified by | `npm run test:e2e`, 2026-11-10: the linked tests pass as ordinary tests |

## Summary

A sample is always recorded as collected "now". After a home visit, or any
collection entered later, the technician can't say when the sample was
really taken.

## Steps to reproduce

1. Create a home-visit bill, with its samples switched off "Collected now"
   and a due time.
2. Hours after the visit, open the bill, tick the samples and press
   **Record collection** (or use **Mark collected** on Sample revisits).

## Expected

The confirmation offers the collection time, defaulting to now, which the
technician can set to the real time (not in the future).

## Actual

The confirmation says "Recorded as collected now, by you." and there is no
time to change. The same applies at billing: a sample left on "Collected
now" is stamped with the bill's time.

## Root cause

The server already accepts a time: `collectSamples` in
`src/services/billing.js` takes `collectedAt`. The screens never send it:
`client/src/features/billing/BillDetailPage.tsx` (`collect`) and
`client/src/features/revisits/RevisitsPage.tsx` (`collect`) post only
`collectionIds`. The server also accepts any instant, including a future
one or one before the bill; it should refuse those once the field exists.

## Suggested fix

A date-time field in both confirmations, sent as `collectedAt`; the server
refuses a time in the future. Decide whether the new-bill form needs the
same for samples collected before the bill was entered.

## Linked tests

- `e2e/specs/ui/journey-samples.spec.js` › "recording a collection on the bill takes the time the sample was actually taken"
- `e2e/specs/ui/journey-samples.spec.js` › "the revisit list's confirmation takes the real collection time too"
- `e2e/specs/ui/journey-samples.spec.js` › "a collection time in the future is refused, and the sample stays pending"
