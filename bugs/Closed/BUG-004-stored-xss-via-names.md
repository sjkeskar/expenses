# BUG-004: Stored XSS: client/location/category/company/user names are rendered as HTML

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Critical |
| Area | All role pages (`public/js/*.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `robustness/security-inputs.spec.js` › K1a–K1d |
| Assignee | — |
| Resolution | Batch 3 of `bugs/FIX-PLAN.md` — `escapeHtml()` in `public/js/common.js`, applied at every `innerHTML` interpolation of user-typed text (and once inside `attachCombobox`, covering all 13 combobox call sites), plus a Content-Security-Policy header in `src/server.js` |
| Verified by | `robustness/security-inputs.spec.js` › K1a, K1b, K1c, K1d, green in a full `npm run test:e2e` run on 2026-10-15 |

## Summary

Every table, dropdown and `<select>` in the UI is built with template
strings assigned to `innerHTML`, and the free-text values are not escaped.
Any user who can type a name can inject script that runs in every other
user's browser, under their session. That includes an operator typing a
client name, and an admin typing a location, category or company name. For
example, an operator could make an admin's browser promote users, reassign
bills or refund bills.

## Steps to reproduce

1. As an operator, create a bill whose client name is
   `<img src=x onerror="alert(document.cookie)">Acme`.
2. Open My Bills, the Record Payment search, the admin Reassign search, or
   the Analytics client tables.

## Expected

The name is displayed literally, as text.

## Actual

The `onerror` handler runs. The tests confirmed execution in:

- operator/admin **My Bills** table and **Record Payment**/**Reassign** dropdowns (K1a)
- admin and accountant **Analytics** tables (K1b)
- admin **Locations**/**Categories** tables and Create Bill dropdowns (K1c)
- developer **All Users** table (K1d)

## Root cause

31 `innerHTML =` assignments across `public/js/*.js` interpolate raw
values. One of them is the shared `attachCombobox()` in
`public/js/common.js` (`<span>${renderLabel(item)}</span>`). Others include
`loadBills()` in operator.js and admin.js, `loadAnalytics()`,
`loadLocationsTable()`, `loadCategoriesTable()`, `loadOperators()` and
`loadUsers()`.

## Suggested fix

Add an `escapeHtml()` helper to `common.js` and wrap every interpolated
value, or build rows with `document.createElement` + `textContent`. As
defence in depth, add a `Content-Security-Policy` header that disallows
inline event handlers (`script-src 'self'`).

## Linked tests

- `e2e/specs/robustness/security-inputs.spec.js` › `K1a`, `K1b`, `K1c`, `K1d`: `knownBug("BUG-004")`
