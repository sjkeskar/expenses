# End-to-end test pack

Playwright tests against the real app, API and database, for every role:
lead pathologist, pathologist, technician, accountant and developer.

Every rule of Phase 1 (`pivot.md`) has an API spec; every screen has UI
specs and an axe accessibility scan, its main dialogs included.

## Running

Prerequisites (one-time):

1. A separate Postgres database whose name **ends in `_test`**, configured in
   `.env.test` (`DATABASE_URL`, `SESSION_SECRET`). `ptsuser` needs
   `GRANT ALL ON SCHEMA public` on it (see `SETUP_GUIDE.md`, Phase 1).
2. `npm install` and `npx playwright install chromium`.

```bash
npm run test:e2e                         # whole suite (~2 min with E2E_WORKERS=8)
npm run test:e2e -- e2e/specs/billing    # one folder
npm run test:e2e -- -g "home-visit"      # by title
npm run test:e2e:report                  # open the last HTML report
E2E_WORKERS=8 npm run test:e2e           # more parallelism (default 4)
E2E_SHOW_BUGS=1 npm run test:e2e         # show the real failures of known open bugs
```

Every run:

- **drops every table and enum** in the test DB, applies the migrations from
  scratch, and seeds a fixed baseline (`e2e/global-setup.js`,
  `e2e/helpers/seed.js`). It refuses to start unless the database name
  ends in `_test`;
- **builds the frontend** (`npm run build`) and starts its own app server on
  port **8090** (`E2E_PORT`), so a dev server on 8080 is never touched;
- writes traces and failure artefacts to `e2e/test-results/` and the HTML
  report to `e2e/report/` (both git-ignored).

## Two projects

- **chromium**: every spec except `specs/lead/`, fully parallel.
- **lead**: `specs/lead/` runs after the rest, one test at a time. It changes
  lab-wide state every other spec relies on: who the lead pathologist is,
  the lab's name. It always restores it, and its last tests (first-run
  setup, through the API and in the app) leave the lab set up afresh. That's
  why `--repeat-each` should be run with `--project=chromium`.

Browsers run with reduced motion, which switches antd's animations off, so
dialogs and messages appear at once. `window.print()` is replaced by a
counter in every signed-in page (`fixtures.js`), so print views can be
checked without a print dialog.

## Layout

```
playwright.config.js        config (loads .env.test, starts the server, the two projects)
e2e/
  global-setup.js           drop everything + migrate + seed (refuses non-_test DBs)
  fixtures.js               test/expect + fixtures: users, api(), leadApi, techApi, loginAs(), knownBug()
  helpers/
    seed.js                 baseline users, lab settings, locations, catalog, doctor, panels
    db.js                   Prisma access: createUser(), baseline lookups
    api.js                  ApiClient: registerPatient(), createBill(), pay(), cancel(), …
    data.js                 uid(), phone(), ist(), istDate(), billPrefix()
    ui.js                   chooseOption() for antd Selects, addItem() for quote/bill items
    server.js               spawn extra app servers (short sessions, restarts)
  specs/
    auth/                   the role × endpoint permission matrix
    admin/                  sign-in, accounts (lead only), lab settings, locations
    patients/               derived numbers, no duplicates, look-alikes, approved corrections
    catalog/                catalog changes and approvals, profiles, referring doctors
    billing/                bills, home visits, samples, payments, discounts, cancellations,
                            refunds, pricing, camps, settlement, bill numbers, day sheet,
                            analytics and the period tally
    quotations/             48 h validity, conversion, expired-but-unchanged, re-issue, verify
    robustness/             concurrency (payments, cancellations, settlement, approvals,
                            quote conversion, reassignment), headers, stored text
    ui/                     the app: shell and menus, lead screens, catalog and approvals,
                            patients, billing, revisits, day sheet, settlement, panels,
                            verify, quotations, analytics, prints, axe scans
    lead/                   hand-over, re-appointment, lab rename, first-run setup (serial; API and app)
```

## Conventions (keep tests independent and parallel-safe)

- **Never mutate seeded records.** Anything a test deactivates, resets or
  retires is created by the test itself (`createUser(role)`, `addLocation()`,
  `addPanel()`, its own catalog codes). Only `specs/lead/` touches the lead,
  and it hands back.
- **Unique everything**, via `uid("Prefix")` and `phone()`: patients that
  shared a phone, sex and age would trip the look-alike check.
- **Bill-number tests own a fresh location** (codes are unique), so their
  sequences are deterministic.
- **Day-sheet and analytics tests own a far-off day**, and pin their money
  movements to it, so totals are exact.
- **Things the API can't do yet are arranged with `db()`**, such as a
  processing status (later phase) or an old timestamp.
- **UI specs arrange through the API and act through the screen.** Find
  elements by role and label, as a person (or a screen reader) would;
  antd Selects go through `chooseOption()`.
- **Every new screen gets an axe scan** in `ui/accessibility.spec.js`,
  dialogs included.
