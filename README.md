# Laboratory Management System

A LAN-based system for a diagnostic laboratory: the test catalog, quotations,
billing, payments, sample collection and the money reports an accountant
audits. It runs on one Windows server PC; every other PC uses it through a
browser.

**Phase 1** (this release) covers the catalog, quotations and billing. Sample
processing, results, reports and turnaround-time calculation come in later
phases. The plan and every decision behind it are in [`pivot.md`](pivot.md).

- **Setting up a server PC:** [`SETUP_GUIDE.md`](SETUP_GUIDE.md), step by step.
- **Finding your way around the code:** [`REFERENCE.md`](REFERENCE.md).
- **Tests:** [`e2e/README.md`](e2e/README.md). **Known bugs:** [`bugs/`](bugs/README.md).

## What it does

| Area | What staff do |
|---|---|
| Front desk | A quick access bar in the header: New bill, New quotation and Register patient for technicians (also Alt+B, Alt+Q, Alt+P), the approval queue for pathologists. Home shows who is due back today and the money taken. |
| Patients | Register (name, age or date of birth, sex, phone), search by name, phone or patient number, propose corrections. A new patient can be entered straight into a bill. Duplicates can't be entered. |
| Catalog | Tests (with sample draws and the machines they run on), profiles (with their tests) and services, entered in a grid or pasted from Excel. The lead approves changes. |
| Quotations | Priced quotes valid for 48 hours, printed on the Zebra GT820, converted into bills, re-issued when they expire and prices have changed. |
| Bills | A grid of the 18 most-used tests (chosen from the last 90 days) and a search that takes several codes at once. Referral (walk-in or doctor), payer (self, or a panel with its own rates or a running camp), home visits, samples taken now or on a revisit, discounts, payments, cancelling tests with partial refunds, an A4 print with a verification barcode. |
| Approvals | Discounts, cancellations and patient corrections (pathologists or the lead); catalog changes and new doctors (the lead). A bill's report is held until its approvals are through. |
| Day sheet | Everything one person took and billed on a day, with the cash hand-over figure by payment mode. |
| Analytics | The accountant's tally for any period (equal to the sum of its day sheets), plus summaries by day, staff, location, referral, payer and test, each downloadable as a PDF. |

## Roles

| Role | Can |
|---|---|
| Lead pathologist (exactly one) | Everything a pathologist can, plus user accounts, branches, panels and camps, machines, lab settings, catalog and doctor approvals, reassigning bills, analytics, and handing over to another pathologist |
| Pathologist | All reception work; approves discounts, cancellations and patient corrections |
| Technician | Reception: patients, quotations, bills, payments, samples, settlement; proposes catalog changes, doctors and corrections |
| Accountant | Read-only: bills, any day sheet, analytics with PDFs |
| Developer | Installation only: first-run setup, and re-appointing the lead after 7 days of lead inactivity |

The server enforces every permission (`src/middleware/auth.js`). The menu
only hides what a role can't use.

## Stack

- **Server:** Node.js 24 LTS, Express 4, Prisma 5 with PostgreSQL 18, argon2
  password hashing, server-side sessions (in memory, 4 hours).
- **Browser app:** React 19 + TypeScript + Vite, with Ant Design 6 (`client/`).
  It is built on the server PC at every deploy, into `client/dist`, which the
  Express server serves alongside the API. JsBarcode draws the barcodes;
  jsPDF builds the analytics PDFs. Everything is bundled: nothing is loaded
  from the internet.
- **Port:** 8080. Plain HTTP on the LAN.

## Running it

```
npm ci                    # dependencies, including the build tools
npx prisma migrate deploy # create or update the database tables
npm run build             # type-check and build the browser app
npm start                 # http://localhost:8080
```

For development, run the API and the app side by side:

```
npm run dev               # API on 8080, restarting on changes
npm run dev:client        # the app with hot reload on http://localhost:5173
```

On a fresh database, create the first developer account
(`scripts/create-first-developer.sql`), sign in as them, and open **Lab
setup**: it records the lab's name and contact details and creates the lead
pathologist, who then creates everyone else's account. `SETUP_GUIDE.md` walks
through all of it.

To deploy a new version on the server PC, run `scripts\deploy.ps1` in an
Administrator PowerShell: it pulls, installs, migrates, builds and restarts
the service.

## Rules the code keeps

- **India Standard Time only.** Timestamps are stored as `timestamptz` and
  shown or bucketed in Asia/Kolkata (`src/utils/istDate.js`,
  `client/src/lib/format.ts`, `AT TIME ZONE` in analytics SQL), whatever
  timezone a PC is set to.
- **Money is integer paise on the server** (`src/utils/money.js`), never a
  float. The browser only displays amounts; prices always come from the
  server's pricing function.
- **Every write that changes a bill's money locks the bill row first**
  (`SELECT … FOR UPDATE`), so several technicians working at once can't
  overpay or double-cancel a bill.
- **Bill numbers** are `{locationCode}{YY}{MM}{seq}`, e.g. `0126100042`: the
  branch or centre's 2-digit code, the year and month, and a 4-digit sequence
  that restarts each month. Quotations use the same scheme with a `Q` in
  front, e.g. `Q0126100007`.
- **Patient numbers** are 13 digits derived from the patient's name, date of
  birth, sex and phone, with a check digit. The same details always give the
  same number. A correction re-derives it, and the old number still finds the
  patient.
- **Verification codes** on every quotation and bill are random 12-character
  codes, printed as Code 128 barcodes. Scanning one on the Verify screen shows
  the lab's own record of the document.
- **Printing goes through the browser.** Bills, day sheets and revisit lists
  are A4. Quotations are 104 mm wide on the Zebra GT820, and the page is as
  long as the quotation.

## Project structure

```
prisma/schema.prisma       the database schema (source of truth)
prisma/migrations/         the migrations `prisma migrate deploy` applies
src/server.js              Express entry point: API routes, the built app, CSP
src/routes/                one file per API area, thin wrappers over the services
src/services/              business rules: billing, quotations, approvals, patients, catalog, …
src/utils/                 money, IST dates, bill/patient numbers, verification codes
client/src/                the browser app: pages.tsx lists every screen
  features/                one folder per area (billing, catalog, patients, …)
  print/                   the print views (A4 and GT820) and the barcode
e2e/                       Playwright test pack (API and UI)
scripts/                   deploy, backup, first developer, resets
bugs/                      the bug tracker
```

## Tests

```
npm run test:e2e
```

This runs the whole Playwright pack against a separate test database
(`.env.test`), which it drops and recreates on every run. It covers the API
permission matrix, every money and approval rule, concurrency, the screens,
and an accessibility scan (WCAG 2.1 AA) of every screen. See `e2e/README.md`.
