# BUG-005: Settlement with a repeated bill id fails with a misleading "could not be found"

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Settlement API (`src/routes/companies.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `billing/settle.spec.js` › F12 |
| Assignee | — |
| Resolution | Batch 1 of `bugs/FIX-PLAN.md` — duplicate bill ids rejected up front in `src/routes/companies.js` |
| Verified by | `billing/settle.spec.js` › F12, green in a full `npm run test:e2e` run on 2026-10-15 |

## Summary

`POST /api/companies/:id/settle` compares the number of bills found with the
length of `billIds`. If the same id appears twice, the counts differ, and
the request is rejected with `404 "One or more selected bills could not be
found."` even though every bill exists. The UI can't currently send
duplicates, but any other client (or a future UI change) gets a confusing
error.

## Steps to reproduce

`POST /api/companies/<id>/settle` with `{ "billIds": [X, X], "mode": "cash" }`,
where X is a pending bill of that company.

## Expected

`400` with a clear message (e.g. "Each bill can only be selected once."), or
the duplicates silently de-duplicated.

## Actual

`404 "One or more selected bills could not be found."`

## Root cause

`src/routes/companies.js:88`: `if (bills.length !== billIds.length)`.

## Suggested fix

Run `const uniqueIds = [...new Set(billIds)]` up front, and either reject
when `uniqueIds.length !== billIds.length` or carry on with `uniqueIds`.

## Linked tests

- `e2e/specs/billing/settle.spec.js` › `F12: the same bill id sent twice gets a clear validation error`: `knownBug("BUG-005")`
