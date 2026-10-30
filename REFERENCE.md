# Laboratory Management System: Reference and Change-Impact Guide

_As of 2026-10-27, Phase 1._

This is the engineering map of the codebase: what each file is for, who may
do what, and which files a given kind of change will touch. The product
decisions behind it, and why each was made, are in `pivot.md` (§14 is the
decision log).

---

## 1. How a request flows

```
Browser: the React app (client/, built into client/dist)
   │  fetch /api/… with the session cookie   (client/src/api.ts)
   ▼
Express (src/server.js)  ── session store (in memory, 4 h)
   │
   ▼
requireAuth → requireRole(...)      src/middleware/auth.js: re-reads the user on every request
   │
   ▼
route handler (src/routes/*)        thin: parses the request, calls a service
   │  route() turns thrown {status, message} into JSON errors
   ▼
service (src/services/*)            the business rules, in one Prisma transaction
   │
   ▼
Prisma → PostgreSQL
```

Only routes and services talk to the database. Every money-changing write
runs inside `transaction()` (`src/utils/route.js`, 10 s budget) and locks
the bill row first.

---

## 2. Files

### Server

| File | Responsibility |
|---|---|
| `src/server.js` | Entry point: security headers and CSP, sessions, every `/api/*` router (`API_ROUTES`), the built app from `client/dist` with an `index.html` fallback, redirects from the old `*.html` pages, and the crash safety nets. |
| `src/middleware/auth.js` | `requireAuth`, `requireRole`, and the role groups used everywhere: `LEAD`, `RECEPTION` (technician, pathologist, lead), `APPROVERS` (pathologist, lead), `OVERSIGHT` (lead, accountant). |
| `src/utils/route.js` | `route()` (error handling for async handlers: thrown `{status, message, details}`, Prisma P2002 → 409, P2025 → 404) and `transaction()`. |
| `src/utils/money.js` | Integer paise: `toPaise`, `fromPaise`, `parseMoney`. |
| `src/utils/istDate.js` | IST calendar days, bill-number month keys, `parseInstant` (date-times must carry an offset), `ageOn`. |
| `src/utils/billNumber.js` | The atomic per-key counter behind bill and quotation numbers (`BillCounter`). |
| `src/utils/patientNumber.js` | Normalising a patient's mandatory fields, the identity key, and the 13-digit patient number with its Luhn check digit. |
| `src/utils/verificationCode.js` | Random 12-character codes for barcodes (no look-alike characters). |
| `src/services/billing.js` | Pricing (§4.7 of the plan), bill creation (direct or from a quotation), totals, discount approvals, cancellations with refunds, sample collection, report holds. |
| `src/services/quotations.js` | Issuing, re-issuing and cancelling quotations; whether one can be converted now. |
| `src/services/approvals.js` | The approval registry (`defineApproval`), self-approval, review with row locks, resolving rejected cancellations. |
| `src/services/patients.js` | Registration (duplicate block, look-alike check), corrections and their approval. |
| `src/services/catalog.js` | Validating and applying catalog changes, one row or a whole grid batch. |
| `src/services/doctors.js` | Adding doctors; a rejected doctor is dropped from their bills. |
| `src/services/lead.js` | Changing the lead pathologist (hand-over, developer re-appointment), with a lock so there's only ever one. |
| `src/services/priceLists.js` | Panel and camp price lists. |
| `src/routes/*.js` | One router per area: `auth`, `users`, `settings`, `locations`, `patients`, `doctors`, `panels`, `camps`, `catalog`, `machines`, `approvals`, `quotations`, `bills`, `transactions`, `daysheet`, `verify`, `analytics`. Each endpoint's comment gives its body. |
| `prisma/schema.prisma` | The schema. Every new field or status starts here, then a migration (`prisma/migrations/`). |

### Browser app (`client/src`)

| File | Responsibility |
|---|---|
| `pages.tsx` | Every screen once: path, menu label and group, roles, component. Drives the routes and the side menu. `PRINTS` lists the print views. |
| `App.tsx`, `auth/` | Routes, the role guard, sign-in and the session. |
| `layout/AppShell.tsx` | Header, account menu, the grouped side menu (collapsible, remembered per PC), and the lab settings every page can read (`useShell`). |
| `layout/QuickAccess.tsx` | The quick access bar in the header: New bill, New quotation and Register patient for technicians; the approval queue with its count for pathologists and the lead; the Alt+B / Alt+Q / Alt+P shortcuts for all reception roles. |
| `components/Page.tsx` | `Page`, `Section` (with `flush` tables and a `toolbar` strip), `Figures`, the `COL` field widths and `NOWRAP`. Every screen is built from these (layout rules in `pivot.md` §12.4). |
| `components/FormModal.tsx` | Every dialog form: busy OK button, errors shown inside the dialog. |
| `lib/hooks.ts` | `useApi` (load and reload) and `useAction` (one run at a time: no double submits). |
| `lib/format.ts` | All dates (IST), money and labels. Components never call dayjs themselves. |
| `types/api.ts` | The API's response shapes. |
| `features/billing/order.tsx` | What a quotation and a bill share: place, referral, payer, items (the most-used tiles from `/catalog/popular`, and a search that takes several codes at once), and live server pricing (`/bills/preview`). |
| `features/billing/` | Bills list, New bill (incl. converting a quotation), Bill detail with its dialogs. |
| `features/quotations/` | Quotations list, New quotation, Quotation detail (convert, re-issue, cancel). |
| `features/patients/` | Patients, patient detail and corrections, the register dialog, the patient fields (dialog or inline) with the look-alike choice, and the patient box of quotes and bills (search, or "New patient: …" inline). |
| `features/catalog/` | The catalog table, the entry grid (with Excel paste), machine-step text (`steps.ts`). |
| `features/approvals/` | The approval queue, My requests, and how each kind of request is shown. |
| `features/analytics/` | Period presets, the tally, the summaries, and the PDFs (`pdf.ts`). |
| other `features/*` | Revisits, day sheet, panels and camps, settlement, verify, machines, doctors, users, branches, lab settings, setup, home. |
| `print/` | The print frame (A4 or the GT820's 104 mm with a content-length page), bill, quotation, day sheet and revisit layouts, and the barcode. |

### Scripts and tests

| File | Responsibility |
|---|---|
| `scripts/deploy.ps1` | Pull, install, generate, migrate, build, restart the service. |
| `scripts/create-first-developer.sql`, `generate-password-hash.js` | The one hand-made account. |
| `scripts/reset-test-data.sql` | Clears patients and billing, keeps the setup. |
| `scripts/consolidate-migrations.ps1` | Full wipe and a single fresh migration (go-live only). |
| `scripts/backup.bat` | Nightly `pg_dump`. |
| `e2e/` | The Playwright pack: API specs, UI specs and accessibility scans; `e2e/README.md` explains the layout. |

---

## 3. Roles

| Capability | Technician | Pathologist | Lead | Accountant | Developer |
|---|---|---|---|---|---|
| Patients, quotations, bills, payments, revisits, cancellations, discounts, settlement | ✓ | ✓ | ✓ | read bills | — |
| Own day sheet / anyone's | own | own | anyone's | anyone's | — |
| Propose catalog changes and doctors | ✓ | ✓ | applies directly | — | — |
| Propose a patient correction | ✓ | applies directly | applies directly | — | — |
| Approve discounts, cancellations, corrections (own included) | — | ✓ | ✓ | — | — |
| Approve catalog changes and doctors; resolve rejected cancellations | — | — | ✓ | — | — |
| Panels, camps, branches, machines, lab settings, user accounts, reassigning bills, hand-over | — | — | ✓ | — | — |
| Analytics and PDFs | — | — | ✓ | ✓ | — |
| First-run setup; re-appointing the lead after 7 days of lead inactivity | — | — | — | — | ✓ |

`e2e/specs/auth/permissions.spec.js` checks every endpoint against this
table, for every role.

---

## 4. Features, and where they live

| Feature | Server | Browser | Key behaviour |
|---|---|---|---|
| Patients | `services/patients.js`, `routes/patients.js` | `features/patients/` | Same details → same patient (unique identity key). Look-alike = same phone, sex, birth year ±1. Corrections re-derive the number; old numbers stay searchable. |
| Catalog | `services/catalog.js`, `routes/catalog.js` | `features/catalog/` | A batch is all-or-nothing with per-row errors. Changes apply when the lead approves. Profiles hold tests; tests hold draws and machine steps. |
| Pricing | `priceFor`, `resolveContext`, `priceLines` in `services/billing.js` | `order.tsx` (display only) | Running camp → panel's standing list → catalog. A home visit costs at least the location's charge. |
| Bills | `createBill` and friends in `services/billing.js` | `features/billing/` | Totals are derived. Every line snapshots its price. Samples per draw, collected now or due back. |
| Quotations | `services/quotations.js`, `quoteLines` in `services/billing.js` | `features/quotations/` | Valid 48 h at the quoted prices. After that, convertible only if every price is unchanged; otherwise re-issue. Converting locks the quote. |
| Discounts | `recordDiscountChange` in `services/billing.js` | Bill detail, payment dialog | One pending request per bill. A rejection reverts to the last approved figure. |
| Cancellations | `cancelItems` in `services/billing.js` | Bill detail → Cancel tests | Refused once processing has started. Refunds whatever was collected beyond the new net amount. |
| Approvals and holds | `services/approvals.js`, `reportHolds` | `features/approvals/`, hold badges | Holds are shown in Phase 1; report generation will enforce them later. |
| Day sheet | `routes/daysheet.js` | `features/daysheet/`, `print/DaySheetPrint.tsx` | Built from money movements (payments, settlements, refunds), so periods reconcile with the tally. |
| Analytics | `routes/analytics.js` | `features/analytics/` | Collected = payments − refunds. Billed totals exclude cancelled lines and cancelled bills. |
| Verify | `routes/verify.js` | `features/verify/` | Finds a bill or quotation by its code; flags patient corrections made after the document was printed. |
| Printing | — | `print/` | Browser printing. A4 for bills and lists. The GT820 quotation sets `@page` to 104 mm × its measured height just before printing. |

---

## 5. Change-impact playbook

| If you want to… | Touch | Watch out for |
|---|---|---|
| Add a field to bills | `schema.prisma` + a migration → `BILL_DETAIL` in `services/billing.js` → `types/api.ts` → Bill detail and `print/BillPrint.tsx` | Patient details are read live, never copied onto bills. Keep it that way, so corrections show on old bills. |
| Change how prices are worked out | `priceFor` / `priceLines` / `resolveContext` | Quotes and bills share these. A quote within its 48 h must keep its prices (`quoteLines`). |
| Add a kind of approval | an `ApprovalSubject` enum value → `defineApproval(...)` in the owning service → `routes/approvals.js` `withDetails` → `ApprovalDetails.tsx`, `SUBJECT_LABELS`, `REJECT_EFFECT` | Decide who approves, what approving or rejecting does, and whether it holds a report (`reportHolds`). |
| Add a money movement | `schema.prisma` → `MOVEMENTS` in `routes/analytics.js` → `routes/daysheet.js` | The tally must keep equalling the sum of the day sheets. The spec "the period tally equals the sum of that period's day sheets" checks it. |
| Add a payment mode | `PaymentMode` enum + migration → `utils/paymentModes.js` → `MODE_LABELS` in `lib/format.ts` → the `FILTER (WHERE mode = …)` columns in `routes/analytics.js` | The enum, `VALID_MODES` and the labels must agree; nothing checks it automatically. |
| Add a screen | a component under `features/` → one entry in `pages.tsx` | Build it from `Page`/`Section`/`COL` (`pivot.md` §12.4), screenshot it at 900/1366/1920 px, and add it to `e2e/specs/ui/accessibility.spec.js`. |
| Add a print | a component under `print/` using `PrintFrame` → an entry in `PRINTS` | Black only, no greys or fills (thermal printers dither them). Report holds never appear on patient prints. |
| Change bill or quote numbering | `utils/billNumber.js`, `buildBillCounterKey`, the `Q` key in `services/quotations.js` | Location codes are unique, so the key `{code}{YY}{MM}` never collides between locations. |
| Change dates or timezone | `utils/istDate.js`, `utils/dateRange.js`, `AT TIME ZONE` in `routes/analytics.js`, `lib/format.ts` | All four must agree. Never shift timestamps with `+ interval` arithmetic. |
| Change a role's permissions | the route's `requireRole(...)` → `pages.tsx` roles → `MATRIX` in `permissions.spec.js` | The menu hiding a screen is not access control: the route check is. |

---

## 6. Known gaps and risks

- **Payments can't be corrected or deleted from the screens** (BUG-006, parked).
  `PATCH` and `DELETE /api/transactions/:id` exist and keep the totals and
  discount approvals right, but there's no UI until the product owner
  decides who may use them.
- **The GT820 hasn't printed yet.** The quotation layout and its
  content-length page are tested in Chrome only. Print and scan on the real
  printer before go-live (`SETUP_GUIDE.md` Phase 7).
- **Sessions are in memory.** A restart signs everyone out. This is an
  accepted trade-off.
- **Reassigning a bill moves its whole history** in the staff-wise
  analytics to the new person (the bill is grouped by its current
  technician). The reassignment log keeps the truth, but no report reads it.
- **Report holds are shown, not enforced.** Phase 1 has no report
  generation; when it arrives it must refuse while `holds` isn't empty.
- **Test-wise analytics group by the item's current code and name**, not the
  snapshot on each bill line, so a renamed test reports under its new name.
