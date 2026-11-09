# BUG-021: A record that can't be loaded shows a blank page, with no message

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Bill, quotation and patient pages; New bill / New quotation opened from a link |
| Reported | 2026-11-09 |
| Found by | E2E test `e2e/specs/ui/admin-reports-flows.spec.js` › `Navigation › a record that doesn't exist says so instead of a blank page` |
| Assignee | — |
| Resolution | Fixed for every screen, not per page: `useApi` (`client/src/lib/hooks.ts`) throws a failed first load to the screen's error boundary (`client/src/components/ErrorBoundary.tsx`, put on every route by `client/src/App.tsx` from the route list), which shows "not found" with the way back to the list, "couldn't be loaded" with Try again, or a crash notice. A failed refresh keeps the data and shows a message; `optional` data (widgets, badges, a dialog's list) only ever shows a message. Lab settings and Lab setup now load their own settings rather than borrowing the header's optional copy. Not yet committed. |
| Verified by | `e2e/specs/ui/load-failures.spec.js` (every route in `pages.tsx` with every read failing; not-found for each detail screen and print; back link; Try again; failed refresh; optional data), and the original test in `ui/admin-reports-flows.spec.js` (marker removed). With the fix disabled, 37 of its 42 tests fail. Full `npm run test:e2e` green on 2026-11-09. |

## Summary

When a detail page's record can't be loaded (a wrong or old link, a mistyped
id, or a server error), the page stays empty under the menu forever. The
server's message ("Bill not found.", "Quotation not found.", "Patient not
found.") is fetched but never shown.

## Steps to reproduce

1. Sign in as any reception user.
2. Open `/bills/00000000-0000-0000-0000-000000000000` (or the same id under
   `/quotations/` or `/patients/`, or `/bills/new?quotation=<that id>`).

## Expected

The page says the record wasn't found (or couldn't be loaded), with a way
back, e.g. to the list.

## Actual

A blank content area; nothing tells the user what went wrong.

## Root cause

`useApi` (`client/src/lib/hooks.ts`) keeps a failed load in `error`, but these
pages only check for data and render nothing until it arrives:

- `client/src/features/billing/BillDetailPage.tsx:41`
- `client/src/features/quotations/QuotationDetailPage.tsx:33`
- `client/src/features/patients/PatientDetailPage.tsx:30`
- `client/src/features/billing/NewBillPage.tsx:31` (`?quotation=` / `?patient=`)
- `client/src/features/quotations/NewQuotationPage.tsx:25` (`?patient=`)

List pages have the milder form of the same gap: the table stops loading and
shows as empty, with no error.

## Suggested fix

In each page, render the load error when `data` is missing and `error` is set,
e.g. an antd `<Result status="404" title={error} extra={<Link to="/bills">Back to bills</Link>} />`
(`status="warning"` for non-404s). A small shared component would keep the
pages consistent.

## Linked tests

- `e2e/specs/ui/admin-reports-flows.spec.js` › `Navigation › a record that doesn't exist says so instead of a blank page` (was `knownBug("BUG-021")`)
- `e2e/specs/ui/load-failures.spec.js`: the whole spec
