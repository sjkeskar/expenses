# End-to-end UI test pack

Automated Playwright tests that drive the real UI (and, where the UI can't
reach, the real API) for all four roles: operator, admin, developer and
accountant.

## Running

Prerequisites (one-time):

1. A separate Postgres database whose name **ends in `_test`**, configured in
   `.env.test` (`DATABASE_URL`, `SESSION_SECRET`). `ptsuser` needs
   `GRANT ALL ON SCHEMA public` on it (see the main README, step 2).
2. `npm install` and `npx playwright install chromium`.

```bash
npm run test:e2e                         # whole suite, headless (~2–4 min; faster with E2E_WORKERS=8)
npm run test:e2e -- e2e/specs/billing    # one folder
npm run test:e2e -- -g "D14"             # by test id / title
npm run test:e2e:ui                      # Playwright UI mode (watch + time-travel)
npm run test:e2e:report                  # open the last HTML report
npm run test:e2e:update-snapshots        # re-baseline visual snapshots after an intended UI change
E2E_SHOW_BUGS=1 npm run test:e2e         # show the real failures of known open bugs
E2E_WORKERS=8 npm run test:e2e           # more parallelism (default 4)
```

Every run:

- applies pending migrations to the test DB, **wipes it**, and seeds a fixed
  baseline (`e2e/global-setup.js`, `e2e/helpers/seed.js`). It refuses to
  start unless the database name ends in `_test`;
- starts its own app server on port **8090** (`E2E_PORT`), so a dev server on
  8080 is never touched;
- writes traces, screenshots and failing-test artefacts to `e2e/test-results/`
  and the HTML report to `e2e/report/` (both git-ignored).

## Visual snapshots (M1)

`specs/visual/` screenshots every page and key state (modals, open
dropdowns, settle list, each admin tab). These tests don't use the database:
every `/api` call is answered from fixed data (`helpers/mock-api.js`), the
browser clock is frozen at 15 Oct 2026, 12:00 IST, and Google Fonts are
blocked. Screenshots therefore depend only on the HTML/CSS/JS. Baselines
are committed in `e2e/__screenshots__/` and are **platform-specific**
(`…-chromium-linux.png`): a different OS needs its own baselines.

The comparison tolerance is deliberately tight (at most 10 pixels, each
within a 0.05 colour threshold), because the rendering is fully
deterministic. A looser ratio-based limit once let a badge text-colour change
pass unnoticed.

When a snapshot fails, open the HTML report to see expected, actual and the
diff. If the change was intended, run `npm run test:e2e:update-snapshots`
and commit the new PNGs together with the UI change.

## Reading the results

- **passed**: includes tests marked `knownBug("BUG-NNN")` that failed as
  expected. They reproduce an open bug from `bugs/Open/`.
- **failed** with "Expected to fail, but passed": a known bug has been
  fixed. Remove the `knownBug(...)` call and move the bug file to
  `bugs/Closed/` (see `bugs/README.md`).
- Any other failure is a regression or a new bug.

## Layout

```
playwright.config.js        config (loads .env.test, starts the server)
e2e/
  global-setup.js           migrate + wipe + seed (refuses non-_test DBs)
  fixtures.js               test/expect + fixtures: users, api(), adminApi, loginAs(), knownBug()
  helpers/
    seed.js                 baseline users/location/categories (never mutated by tests)
    db.js                   Prisma access: createUser(), findBillByNumber()
    api.js                  ApiClient: fast data setup + raw permission checks
    data.js                 uid(), inr(), istDate(), displayDate(), billPrefix()
    pdf.js                  text extraction from the jsPDF downloads
    mock-api.js             fixed API responses for visual snapshots
    server.js               spawn extra app servers (short sessions, restarts)
  pages/                    page objects
    components.js           Combobox, ChangePasswordModal, RefundModal, table helpers
    billing.js              Create Bill / Record Payment / Settle / My Bills (operator + admin)
    admin.js                admin tabs (extends billing)
    analytics.js            analytics tables + PDFs (admin + accountant)
    developer.js, login.js
  specs/
    auth/                   login, guards, logout, sessions, change password, API permission matrix
    developer/              user lifecycle
    billing/                create bill, bill numbers, payments, settlement, my bills + refund
    admin/                  promote, reassign, locations, categories
    analytics/              all analytics tables, IST bucketing, reconciliation, PDFs, accountant read-only
    robustness/             XSS, unusual input, double submit, server errors, concurrency
    accessibility/          axe-core WCAG scans, keyboard-only workflows, modal focus
    visual/                 screenshot regression (mocked API, frozen clock)
  __screenshots__/          committed visual baselines
```

## Conventions (keep tests independent and parallel-safe)

- **Never mutate seeded records.** Anything a test deactivates, promotes,
  demotes or re-passwords is created by the test itself
  (`createUser(role)`). The same goes for locations and categories it
  deletes.
- **Unique names everywhere** via `uid("Prefix")`, so tests never see each
  other's clients, companies or operators.
- **Analytics tests own a calendar day.** Each one builds data on its own
  backdated date, with different years for the admin and accountant
  variants (shifted again per `--repeat-each` run), so date-range filtering
  isolates it.
- **Bill-number tests own a (location code, month) bucket**, so sequence
  numbers are deterministic.
- **Arrange through the API, act and assert through the UI.** Use
  `adminApi.createBill()` and friends for setup, drive the behaviour under
  test in the page, and check persisted state with `db()` where the UI
  doesn't show it.
- **Login is via API inside the browser context** (`loginAs(user)`), so each
  call is an independent session. The login form itself is tested in
  `auth/login.spec.js`.
- **Assert with web-first assertions / `expect.poll`**, never a single read
  after an action. The pages re-render after their fetches complete.

## Coverage map

IDs match the test plan. Each test title starts with its ID.

| Area | IDs | Spec |
|---|---|---|
| Login, guards, logout, session lifetime, restart | A1–A12 | `auth/login`, `auth/session` |
| API permission matrix (all roles × all endpoints) | A11, J2, K5 | `auth/api-permissions` |
| Change password (all 4 pages) + policy, field isolation on developer.html | B1–B6 | `auth/change-password` |
| Developer user management, live-session effects | C1–C9 | `developer/users`, `auth/session` |
| Create Bill (operator + admin), IST bill date | D1–D21 | `billing/create-bill` |
| Bill numbering, rollover, 9999 cap, concurrency | D14–D16, L1 | `billing/bill-number` |
| Record Payment, transaction edit/delete API | E1–E16 | `billing/record-payment` |
| Settle Company Balance, settle-list loading | F1–F17 | `billing/settle` |
| My Bills totals, Refund modal | G1–G5 | `billing/my-bills-refund` |
| My Bills PDF, every analytics PDF | G7, I8 | `analytics/pdf-export` |
| Admin tabs: promote, reassign, locations, categories | H0–H11 | `admin/admin-tabs` |
| Analytics tables, IST day bucketing, refunds, reconciliation | I1–I9, G6 | `analytics/analytics` |
| Accountant is read-only | J1, J2 | `analytics/analytics`, `auth/api-permissions` |
| XSS, Unicode, junk input, double submit, server errors, CSP and no-store headers | K1–K8 | `robustness/security-inputs` |
| Concurrent writes on one bill | L2–L6 | `robustness/concurrency` |
| Visual regression of every page/state | M1 | `visual/visual` |
| Accessibility scans (WCAG 2.1 A/AA + best practice) | M2 | `accessibility/axe` |
| Keyboard-only workflows, focus visibility, modal focus, combobox timing | M3a–M3j | `accessibility/keyboard` |
