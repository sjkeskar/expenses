# Bug Tracker

Bugs found in the Payment Tracking System, one Markdown file per bug.
The folder a file sits in is its status.

```
bugs/
├── README.md      this file: workflow + index
├── TEMPLATE.md    copy this to file a new bug
├── Open/          confirmed, not yet being worked on
├── WIP/           someone is fixing it
└── Closed/        fixed and verified (or won't fix, with a reason)
```

## Workflow

1. **File:** copy `TEMPLATE.md` to `Open/BUG-NNN-short-slug.md`, using the
   next free number. Fill in every section. Add a row to the index below.
2. **Start work:** `git mv bugs/Open/BUG-NNN-*.md bugs/WIP/`, then set
   `Status: WIP` and `Assignee`.
3. **Fix:** fix the code. The bug's linked E2E tests are marked with
   `knownBug("BUG-NNN")` and assert the *correct* behaviour. Once the fix
   lands, they "unexpectedly pass", and Playwright reports that as a failure.
   Delete the `knownBug("BUG-NNN")` lines so they become normal tests.
4. **Close:** run `npm run test:e2e` until it is fully green, then
   `git mv bugs/WIP/BUG-NNN-*.md bugs/Closed/`. Set `Status: Closed`, and
   fill in `Resolution` (commit / PR) and `Verified by`.

To see the real failure output of every open bug instead of the
expected-failure summary, run `E2E_SHOW_BUGS=1 npm run test:e2e`.

## Severity scale

| Severity | Meaning |
|---|---|
| Critical | Money or audit data silently wrong, or a security hole exploitable by any logged-in user |
| High | Security weakness or data-integrity problem needing specific conditions |
| Medium | A feature is broken or produces wrong results; a workaround exists |
| Low | Cosmetic, confusing message, or rare edge case |

## Index

| ID | Title | Severity | Area | Status |
|---|---|---|---|---|
| [BUG-001](Closed/BUG-001-developer-change-password-reads-wrong-field.md) | Developer page: Change Password reads the Create User password field | Medium | Developer UI | Closed |
| [BUG-002](Closed/BUG-002-transaction-edit-delete-unrefunds-bill.md) | Editing/deleting a payment on a refunded bill silently un-refunds it | High | Transactions API | Closed |
| [BUG-003](Closed/BUG-003-stale-session-role-and-deactivation.md) | Deactivated users and demoted admins keep their access until the session expires | High | Auth / sessions | Closed |
| [BUG-004](Closed/BUG-004-stored-xss-via-names.md) | Stored XSS: client/location/category/company/user names are rendered as HTML | Critical | All UI pages | Closed |
| [BUG-005](Closed/BUG-005-settlement-duplicate-bill-ids-misleading-error.md) | Settlement with a repeated bill id fails with a misleading "could not be found" | Low | Settlement API | Closed |
| [BUG-006](Open/BUG-006-no-ui-to-edit-or-delete-payments.md) | No UI to correct or delete a recorded payment | Medium | Operator/Admin UI | Open |
| [BUG-007](Closed/BUG-007-back-after-logout-shows-stale-page.md) | Back button after logout shows a half-working role page | Low | Auth / caching | Closed |
| [BUG-008](Closed/BUG-008-floating-point-money-comparisons.md) | Floating-point money maths rejects exact amounts (e.g. 0.30 − 0.10) | Medium | Bills / Transactions API | Closed |
| [BUG-009](Closed/BUG-009-combobox-stale-blur-timer.md) | Combobox list vanishes when a field is re-focused within 150 ms | Low | Shared UI (common.js) | Closed |
| [BUG-010](Closed/BUG-010-double-submit-creates-duplicates.md) | Double-clicking Create Bill / Record Payment creates duplicates | Medium | Operator/Admin UI | Closed |
| [BUG-011](Closed/BUG-011-concurrent-writes-race-conditions.md) | Concurrent payments/settlements overpay bills; concurrent reassignments corrupt the audit trail | Critical | Bills / Transactions / Settlement | Closed |
| [BUG-012](Closed/BUG-012-badge-colour-contrast.md) | Status/role badges fail WCAG AA colour contrast | Medium | Styles | Closed |
| [BUG-013](Closed/BUG-013-settle-checkboxes-unlabelled.md) | Settle Company Balance checkboxes have no accessible name | Medium | Operator/Admin UI | Closed |
| [BUG-014](Closed/BUG-014-combobox-aria-incomplete.md) | Search dropdowns (comboboxes) use incomplete ARIA | Medium | Shared UI (common.js) | Closed |
| [BUG-015](Closed/BUG-015-modals-not-keyboard-accessible.md) | Modals don't manage keyboard focus (no focus move/trap/Escape/restore) | Medium | Shared UI | Closed |
| [BUG-016](Closed/BUG-016-input-focus-ring-overridden.md) | Intended keyboard focus ring for inputs/selects is overridden by later CSS | Low | Styles | Closed |
| [BUG-017](Closed/BUG-017-login-page-no-main-landmark.md) | Login page has no main landmark | Low | Login page | Closed |
| [BUG-018](Closed/BUG-018-tab-from-combobox-loses-focus.md) | Tabbing out of a search field with a long list loses keyboard focus | Medium | Shared UI (common.js) | Closed |
| [BUG-019](Closed/BUG-019-settle-list-double-load-wipes-ticks.md) | Picking a settlement company loads its bills twice; the second load wipes ticked bills | Medium | Operator/Admin UI | Closed |
| [BUG-020](Closed/BUG-020-settle-list-not-refreshed-after-failed-settlement.md) | After a failed settlement, the settle list can't be refreshed by re-picking the company | Low | Operator/Admin UI | Closed |
