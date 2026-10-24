# Pivot: Payment Tracking System → Laboratory Management System (POS module)

Status: **planning only, no code changed yet.** Written 2026-10-24 against
`develop` @ `b15f0c8`.

What we've built so far becomes the **POS / front-desk module** of a lab
system. On top of the money handling we already have, a lab bill needs:

1. **The tests requested** on the bill, each with the time it was requested.
2. **When the patient should expect the final report.**
3. **Whether the patient needs to come back (or came back) to give a sample later**
   (e.g. fasting blood tomorrow morning, urine today).
4. A large **test catalog** that keeps growing.
5. A **Quotation** screen used before a bill is generated.

---

## 1. Guiding principle: keep the money layer untouched

All the money logic works at the **bill level**: `Bill.originalAmount / discountAmount
/ netAmount / balance`, transactions, extra discount at payment time, company
settlement, whole-bill refund, reassignment and all 6 analytics reports. It is
tested, concurrency-safe and works in paise.

The plan therefore **adds line items under the bill but leaves the bill-level totals as they are**:

- `Bill.originalAmount` stops being typed in by the operator. The server computes it
  as `SUM(billItems.price)`.
- Everything that reads bill totals (transactions.js, companies.js settle, the refund
  route, analytics.js) keeps working **with no change**.

This is what keeps the backend change small. The new work is additive:
new tables, new routes, and one changed route (`POST /api/bills`).

---

## 2. Naming changes

| Today | Proposed | Where it changes | Notes |
|---|---|---|---|
| "Payment Tracking System" | "Laboratory Management System" (page headers can say "… — POS") | 5 HTML `<title>`/`<h1>`, `package.json` name/description, `server.js` log line, README / REFERENCE / SETUP_GUIDE, `scripts/*.sql/.bat/.ps1`, `.env.example`, `playwright.config.js`, `bugs/README.md` | Rename the DB `payment_tracking` → `lms`? **Only if there's no live install**: it touches every `.env` and the backup script. |
| Client | **Patient** | UI labels, plus schema/API (see 2.1) | Biggest rename. |
| Bill | Bill (keep) | — | Labs say "bill" too. |
| "Original amount (MRP)" field | removed | Create Bill form | Becomes the computed sum of test prices. |
| Operator (role) | Keep the `operator` enum value. UI label TBD ("Front Desk"?) | UI labels only | Changing the enum means a migration plus every `requireRole(...)`; not worth it. |
| Category / Company | Keep the models. UI labels TBD (e.g. "Billing Type" / "Panel / Corporate") | UI labels only | In labs a "credit company" is normally a corporate tie-up, TPA/insurer or referring hospital. Same behavior, different words. |
| Location | Keep. UI label maybe "Branch / Collection Centre" | UI labels only | The 2-digit code and bill-number prefix are unchanged. |

### 2.1 How deep the Client → Patient rename goes

Recommendation: **a full rename (Prisma model, DB table/columns, API paths, JS
names, element ids), if there is no production data yet.** All the new code
(bill items, samples, quotations, report ETA) is about patients. Code that says
`client` while the UI says "Patient" would cause confusion for as long as the
codebase exists, and the rename gets more expensive with every feature added on top.

How to do it safely:

- `prisma migrate dev` treats a model/table rename as **drop + create**, which
  **deletes the data**. The migration must be edited by hand to use
  `ALTER TABLE "clients" RENAME TO "patients"` and
  `ALTER TABLE "bills" RENAME COLUMN "clientId" TO "patientId"` (same for
  `transactions`), plus renaming the FK constraints and indexes.
- Raw SQL in `src/routes/analytics.js` uses `"clients"` and `"clientId"` directly;
  each of those queries must be updated by hand (they don't fail at compile time).
- API: `/api/clients` → `/api/patients`, `/api/analytics/client-outstanding|client-daily|client-ledger`
  → `patient-*`. The body field `clientId/clientName` → `patientId/patientName`.
- Frontend: element ids `bill-client-*`, `ledger-client-*`, table ids
  `client-outstanding-table`, etc. The e2e page objects use these ids, so they
  move together (see §9).

If a live install already holds real data, the fallback is a rename at the code
level only: rename the Prisma model to `Patient` but keep `@@map("clients")` and
`@map("clientId")`, so the DB needs no migration. Raw SQL then still says
`clients`, which is ugly but safe.

### 2.2 Patient fields (currently name only, by an earlier decision)

A lab almost always needs **age, sex and phone** on the patient: age and sex for
reference ranges on the report, phone for report-ready messages. Often a
**referring doctor** is needed too (printed as "Ref. by Dr. …").
This revisits the earlier "clients are name only" decision, so it is listed under
open questions (§11). If accepted, these become nullable columns on `patients`
plus optional fields on the bill form. Find-or-create by name gets weaker,
because two patients can share a name. The patient combobox would then need to
show age/sex/phone in its sub-line (the `renderSub` option already exists) to
tell them apart.

---

## 3. Data model changes (prisma/schema.prisma)

New model names use the `Lab` prefix where a bare name would clash with
something we already have (e.g. "Test" vs. the e2e tests).

### 3.1 `LabTest`: the test catalog (admin-managed, will grow large)

```prisma
model LabTest {
  id          String   @id @default(uuid())
  code        String   @unique          // short code for fast search, e.g. "CBC", "LIPID"
  name        String                     // "Complete Blood Count"
  price       Decimal  @db.Decimal(12, 2) // current MRP; snapshotted onto items
  tatHours    Int                        // turnaround time, used to compute report ETA
  sampleType  String?                    // "Blood", "Urine", ... (enum later if useful)
  isActive    Boolean  @default(true)    // soft delete, same as Location/Category
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  billItems      BillItem[]
  quotationItems QuotationItem[]
  @@map("lab_tests")
}
```

- **Price and TAT are snapshotted** onto every bill/quote item, so changing the
  catalog price never rewrites an old bill. This is also why a price-history table isn't needed yet.
- Panels/profiles (e.g. "Lipid Profile" = 5 tests sold together) are **not modelled
  in v1**. A panel is simply a catalog entry with its own price. If the lab later
  needs to know which tests make up a panel (for report generation), add a
  `LabTestComponent` join table. That doesn't affect POS.

### 3.2 `BillItem`: the tests on a bill

```prisma
enum SampleStatus {
  collected   // sample taken at the bill visit, or at a later revisit
  pending     // patient must come back: see sampleDueAt
}

model BillItem {
  id         String  @id @default(uuid())
  billId     String
  bill       Bill    @relation(fields: [billId], references: [id])
  labTestId  String
  labTest    LabTest @relation(fields: [labTestId], references: [id])

  // Snapshots taken at bill time (see 3.1)
  testName   String
  testCode   String
  price      Decimal @db.Decimal(12, 2)
  tatHours   Int

  requestedAt       DateTime @db.Timestamptz(3)  // = bill timestamp (honours backdating)

  sampleStatus      SampleStatus
  sampleDueAt       DateTime? @db.Timestamptz(3) // when the revisit is expected (pending only)
  sampleCollectedAt DateTime? @db.Timestamptz(3)
  sampleCollectedById String?
  sampleCollectedBy User?    @relation("SampleCollectedBy", ...)

  expectedReportAt  DateTime @db.Timestamptz(3)
  expectedReportOverridden Boolean @default(false) // operator typed a custom ETA

  @@index([sampleStatus, sampleDueAt])  // revisit worklist
  @@index([expectedReportAt])           // reports-due list
  @@map("bill_items")
}
```

**Report-ETA rule** (computed server-side, never trusted from the browser):

```
expectedReportAt = (sampleCollectedAt ?? sampleDueAt ?? requestedAt) + tatHours
```

- The ETA counts from when the **sample** arrives, not from billing. A patient
  billed today who comes back tomorrow for the sample gets a later ETA.
- When a pending sample is marked collected, every item whose ETA has **not** been
  overridden gets its ETA recomputed. Items with a manual override keep it.
- The operator can override the ETA per item (e.g. "Saturday, lab closed Sunday").
  In v1 TAT is plain hours. Cut-off rules ("before 11 AM → same-day 6 PM") are an
  open question (§11), and adding them later only changes this one function.
- **Bill-level ETA** = `MAX(items.expectedReportAt)`. Derive it in the query
  rather than storing a column that can drift.

**Why sample fields sit on the item, not in a separate visit table:** one bill
can have urine collected now and fasting blood tomorrow, so status really is per
test. One revisit usually covers all of a bill's pending items, so the UI sets
one revisit time and applies it to all pending items, and one "mark collected"
action closes them together. A `SampleVisit` table (with a phlebotomist,
home-collection address, etc.) only becomes worthwhile if home collection gets
added. That's noted as a possible later step and not built now.

### 3.3 `Bill` changes

- `originalAmount` becomes **server-computed** from items. The column itself stays.
- Add `quotationId String? @unique` → `Quotation` (one quote converts to at most one bill).
- Optional, if §2.2 is accepted: `referringDoctor String?`.
- Nothing else changes. Refund, reassignment, settlement and the bill-number scheme
  stay as they are.

Old bills with no items, like the "legacy" handling we already have for `locationId`/`categoryId`:
any existing bills simply have zero items and show "—" for tests and ETA.
After the go-live reset (`scripts/consolidate-migrations.ps1`) this won't matter.

### 3.4 `Quotation` + `QuotationItem`

```prisma
enum QuotationStatus { open  converted  cancelled }   // "expired" = open && validUntil < now, derived

model Quotation {
  id            String   @id @default(uuid())
  quoteNumber   String   @unique             // see numbering below
  patientId     String?                       // existing patient, if picked
  patientName   String                        // always stored; patient row created only on conversion
  locationId    String
  categoryId    String
  originalAmount Decimal @db.Decimal(12, 2)
  discountAmount Decimal @default(0) @db.Decimal(12, 2)
  netAmount     Decimal  @db.Decimal(12, 2)
  validUntil    DateTime @db.Timestamptz(3)
  status        QuotationStatus @default(open)
  notes         String?
  createdById   String
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  bill          Bill?                         // back-relation via Bill.quotationId
  items         QuotationItem[]
  @@map("quotations")
}

model QuotationItem {
  id          String @id @default(uuid())
  quotationId String
  labTestId   String
  testName    String           // snapshot
  testCode    String
  price       Decimal @db.Decimal(12, 2)
  tatHours    Int
  @@map("quotation_items")
}
```

- **The patient row is created only when the quote is converted to a bill.**
  Quotes that never convert don't fill the patient list with junk.
- **Numbering:** reuse `generateBillNumber()` and the `BillCounter` table with a
  `Q` prefix on the key (`Q` + locCode + YY + MM → `Q0426100003`).
  `counterKey` is already a free-form string PK, so **no schema change** is needed,
  and quote sequences never collide with bill sequences.
- **Price on conversion:** if the quote is still valid, the bill takes the **quoted**
  prices (that's the point of a quote). Tests added at conversion time use the
  current catalog price.

---

## 4. Backend changes (src/)

Small and mostly additive:

| File | Change |
|---|---|
| `src/services/billing.js` (new) | Move the body of `POST /api/bills` (patient find-or-create, location/category checks, numbering, bill + initial payment in one DB transaction) into `createBill(tx, input, userId)`. **Do this first, with no behavior change**, so `POST /bills` and quote conversion share one code path. |
| `src/utils/reportEta.js` (new) | `computeExpectedReportAt(item)`: the one place the ETA rule lives (§3.2). Pure function, easy to unit test. |
| `src/utils/istDate.js` | Add an "IST date + time string → `Date`" helper. `<input type="datetime-local">` gives a value with no timezone attached, and it must be read as **IST**, never as the browser's or server's local time (same rule as the existing date handling; see README timezone section). |
| `src/routes/bills.js` | `POST /`: replace `originalAmount` with `items: [{ labTestId, sampleStatus, sampleDueAt?, expectedReportAt? }]`, plus optional `quotationId`. The server loads the active tests, snapshots price/TAT, computes `originalAmount = Σ price` in paise, and computes ETAs. Reject an empty items list, duplicate tests and inactive tests. `GET /` and `GET /:id` include `items`. **New** `PATCH /:id/samples` `{ itemIds, collectedAt? }`: marks samples collected, stamps who/when, recomputes ETAs. Lock the bill row first with `SELECT … FOR UPDATE`, like refund does. **New** `PATCH /:id/items/:itemId/eta` for manual override. Both refuse refunded bills. |
| `src/routes/labTests.js` (new) | `GET /` (operator, admin), `POST /` and `PATCH /:id` (admin: price/TAT/name edits), `DELETE /:id` (admin, soft). Same shape as `locations.js` and `categories.js`. |
| `src/routes/quotations.js` (new) | `GET /` (filter by status), `GET /:id`, `POST /`, `PATCH /:id/cancel`, `POST /:id/convert` (in one DB transaction: lock the quote, check it is `open` and not expired, call `createBill` with quoted prices, set `status=converted`). Converting twice must fail cleanly. The `@unique` on `Bill.quotationId` backs that up. |
| `src/routes/worklist.js` (new; or fold into bills.js) | `GET /api/worklist/pending-samples?date=` (items `pending`, due on or before the date, grouped by bill/patient) and `GET /api/worklist/reports-due?date=`. Read-only. |
| `src/routes/analytics.js` | **New** `GET /test-wise` (count and gross revenue per test in the date range). Existing queries unchanged apart from the client→patient rename in raw SQL (§2.1). |
| `src/server.js` | Mount the new routers. Rename strings. |
| `src/routes/transactions.js`, `companies.js`, `users.js`, `auth.js` | **No logic change.** Only `clientId → patientId` if the full rename (§2.1) is chosen. |

**Note on test-wise revenue:** discounts are bill-level, so a test's *net*
revenue isn't exactly defined. v1 reports gross (catalog-snapshot) revenue and
counts. Spreading the discount pro-rata across items is possible later but
should be a deliberate decision.

---

## 5. Frontend: do the duplication cleanup before adding features

Today the Billing UI exists **twice**: `public/js/operator.js` and `public/js/admin.js`
(Billing tab) are near-identical, and so are the matching HTML blocks. Analytics
likewise exists in both `admin.js` and `accountant.js`. Every component below
would otherwise be built twice.

**Step 0 (no behavior change):**

- Extract `public/js/billing.js`: Create Bill, Record Payment, Settle, My Bills,
  Refund modal. Both role pages load it and call `initBilling()`.
- Extract `public/js/analytics.js` shared by admin and accountant.
- The HTML stays duplicated (no build step, no templating), but the blocks are
  identical, so later edits are copy-paste. The alternative is to have
  `billing.js` render the markup itself. That's cleaner, but it's a bigger change
  and makes the HTML harder to scan. Recommendation: **keep the static HTML**.
- The whole e2e suite must stay green through this step without changes. That is the proof
  nothing broke.

`server.js` notes that pages must have no inline `<script>` (CSP
`script-src 'self'`). The new modules are separate files, so that holds.

---

## 6. New / changed UI components

### 6.1 Test picker + line-items editor (shared by Bill and Quotation)

The core new component, `attachTestItemsEditor({ container, tests, mode: "bill" | "quote" })`
in `common.js`:

- A search input built on the existing `attachCombobox` (keyboard/ARIA work from
  BUG-014/018 is reused). It matches on **code or name**. Selecting a test **appends a
  row and clears the input**, ready for the next test (multi-add, unlike the
  single-value comboboxes we have today). Already-added tests are hidden from results.
- Item rows: Code · Test · Price · TAT · Sample (`Collected now` / `Revisit`) · Report ETA · ✕.
  - "Sample" and "ETA" columns appear only in `bill` mode.
  - Choosing "Revisit" reveals one **bill-level** "Revisit on" datetime input that
    applies to all revisit rows.
  - ETA is shown as computed. A small "edit" control turns it into a
    datetime input (sets the override flag).
- Live totals beneath: Subtotal (Σ price) → Discount → Net. "Amount collected now"
  is checked against Net as it is today.
- The browser computes the ETA **for display only**. The server recomputes and stores it.
- Accessibility to keep at today's bar (axe spec runs on every page): a real `<table>`,
  remove buttons labelled "Remove {test name}", totals in a live region.

Performance with "many tests": `GET /api/lab-tests` returns the whole active
catalog once and the combobox filters in the browser. That's fine into the low
thousands of tests. If the catalog grows past that, switch to `?q=` server search;
the component's interface doesn't change.

### 6.2 Create Bill form (operator.html + admin Billing tab)

- Patient (renamed) · Category · Bill date · Location: unchanged.
- **Remove** "Original amount (MRP)". **Add** the items editor (6.1).
- Discount, Amount collected now, Mode: unchanged.
- If opened from a quote: a banner "From quotation Q…" and the items prefilled at quoted prices.
- After a successful create, offer **"Print bill"** (see 6.6).

### 6.3 Quotation screen (new card/tab for operator + admin)

- Form: Patient name (combobox; picking an existing patient sets `patientId`,
  typing a new name only stores the name) · Location · Category · items editor in
  `quote` mode · Discount · Valid until (default: today + N days) · Notes.
- Actions: **Save quotation**, **Download quotation PDF**.
- "Open quotations" table: Quote # · Patient · Tests (count/short list) · Net · Valid until ·
  Status · Actions [**Convert to bill**] [Cancel] [PDF].
- **Convert to bill** prefills the Create Bill form (6.2) with the quote. The operator
  then sets sample status, revisit time and payment, and submits `POST /bills` with
  `quotationId`, rather than converting in one click. Reason: the conversion step is
  where sample/payment details are captured anyway.
  (`POST /quotations/:id/convert` still exists for API use and tests.)
- Quotes stay **optional**. A walk-in can still be billed directly.

### 6.4 Sample revisits & reports-due worklist (new card)

- "Pending samples": patients due back today, plus overdue ones in red. Each row
  shows: Bill # · Patient · Tests pending · Due at · [**Mark collected**].
  Mark collected opens a confirm modal (reuse `setupModal`) listing the pending
  tests as checkboxes (all ticked by default, like the Settle list) and a
  "collected at" time defaulting to now.
- "Reports due": Bill # · Patient · Tests · ETA (sorted). Read-only for now (see §8).

### 6.5 My Bills table

- Add columns **Tests** (short list, with the full list in the row's `title`/expand) and
  **Report ETA**. Add a "Sample pending" badge next to Status. The table is already
  12 columns wide, so an expandable row is likely better than more columns.
  To be decided during the UI step.

### 6.6 Bill receipt / print (new)

There's currently **no printable bill**; only the My Bills list exports to PDF. A
lab bill handed to the patient must show: lab name/location, bill #, patient,
date-time, **each test with price**, discount, net, paid, balance, **report ETA**,
and **"Please come back on … for sample"** if anything is pending. Build it with
the jsPDF we already vendor (`downloadPdfReport` in `common.js` is a starting point,
though a receipt layout differs from a report table). The same renderer, with a
different title, gives the **Quotation PDF**.

### 6.7 Admin: Tests tab (catalog management)

- Add form: Code · Name · Price · TAT (hours) · Sample type. Table with inline
  **Edit** (price/TAT/name change constantly in a lab, unlike Locations/Categories)
  and Deactivate. A search box over the table, since it will be long.
- **Bulk import:** with "many tests getting added", typing them one by one is a
  real cost. Option A: a CSV upload on this tab (`POST /api/lab-tests/import`,
  inserted all-or-nothing, with a per-row error report). Option B: a one-off
  `scripts/import-tests.js` for the initial load, plus the form for later additions.
  Recommendation: **B first**, A if admins keep needing it.

### 6.8 Analytics

- New "Test-wise Summary" card (Test · Count · Gross revenue) with PDF download,
  in the shared analytics module so admin and accountant both get it.
- Rename labels: "Client Outstanding Balances" → "Patient Outstanding Balances",
  "Per-Client Detail" → "Per-Patient Detail". The bill ledger there gains a Tests column.

---

## 7. Roles and permissions

| Capability | operator | admin | accountant | developer |
|---|---|---|---|---|
| View test catalog | ✓ | ✓ | — | — |
| Manage test catalog | — | ✓ | — | — |
| Create / cancel quotation, convert to bill | ✓ | ✓ | — | — |
| Create bill with items | ✓ | ✓ | — | — |
| Mark sample collected, override ETA | ✓ | ✓ | — | — |
| Worklist | ✓ | ✓ | — | — |
| Test-wise analytics | — | ✓ | ✓ | — |

Every new route gets a case in `e2e/specs/auth/api-permissions.spec.js`.

---

## 8. Explicitly out of scope for this pivot (POS module only)

- Entering results, report generation/printing, reference ranges, report approval.
  The "Reports due" list only shows the ETA; nobody marks a report as done yet.
  When the reporting module arrives, `BillItem` gets a `reportStatus`. This design
  leaves room for that.
- Home collection / phlebotomist routing (would introduce `SampleVisit`, §3.2).
- Partial refunds / cancelling one test on a bill. Refund stays whole-bill. Labs do
  cancel single tests, so this is a likely future request; see §11.
- Editing a bill's tests after creation (changes money). v1: refund and re-bill.
- BUG-006 (no UI to edit/delete payments) is still parked and unaffected.

---

## 9. Impact on the e2e suite

- **Page objects** (`e2e/pages/billing.js`, `analytics.js`, `admin.js`) find elements by
  element id. If ids are renamed in the Client→Patient change, update the page
  objects in the same commit. Specs mostly talk to the page objects, so damage stays
  contained. About 100 text assertions across 14 spec files contain "Client",
  "Bill", etc., and need a pass.
- **API helper**: `e2e/helpers/api.js#createBill` currently sends `originalAmount`,
  and specs pass `originalAmount` about 147 times. Keep that option on the
  *helper*: when given `originalAmount`, it uses (or creates via adminApi, cached
  by price) a catalog test priced at that amount and sends it as a single item.
  Existing money specs stay as they are.
- **Seed** (`e2e/helpers/seed.js`): add a few baseline lab tests (different TATs,
  one with a pending-sample scenario).
- **New specs**: `catalog/lab-tests.spec.js`, `billing/bill-items.spec.js` (totals,
  ETA, backdated ETA, revisit), `billing/samples.spec.js` (mark collected → ETA
  recompute, override preserved, refunded bill refuses), `quotations/*.spec.js`
  (create, PDF, convert, double-convert refused, expired refused, quoted price
  honoured after a catalog price change), concurrency (two operators mark the same
  sample collected; two converting the same quote).
- **Visual snapshots**: all 15 baselines change because of the name change. Re-baseline
  with `npm run test:e2e:update-snapshots` after each UI step, and add new states:
  items editor, quotation screen, worklist, Tests tab. `helpers/mock-api.js` needs
  fixtures for the new endpoints.
- `bugs/`: no changes.

---

## 10. Suggested order of work

Each step is shippable on its own and ends with a green suite.

| # | Step | Backend | Frontend | Risk |
|---|---|---|---|---|
| 0 | **Refactor, no behavior change**: `services/billing.js`, `public/js/billing.js`, `public/js/analytics.js`. **Frontend half done 2026-10-25** (all 326 e2e pass, visual baselines unchanged). The backend `services/billing.js` extraction is still pending; it can wait until Step 5 (quotations), its first second caller. | small | medium | low (suite proves it) |
| 1 | **Rename**: app name, Client→Patient (§2.1), labels (§2) | migration (hand-edited) + raw SQL | labels/ids | medium (the migration) |
| 2 | **Test catalog**: `LabTest`, `/api/lab-tests`, admin Tests tab, import script | small | small | low |
| 3 | **Bill items**: `BillItem`, `POST /bills` with items, ETA rule, items editor, Create Bill form, My Bills columns, **bill print** | medium | **large** | medium |
| 4 | **Sample revisits**: `PATCH /bills/:id/samples`, ETA override, worklist card | small | medium | low |
| 5 | **Quotations**: models, routes, Quotation screen, convert flow, quote PDF | medium | medium | medium |
| 6 | **Analytics**: test-wise summary, ledger tests column | small | small | low |
| 7 | Docs: README/REFERENCE/SETUP_GUIDE rewrite for the new domain, schema comments | — | — | — |

Steps 2 and 3 can merge if you'd rather not ship a catalog nobody can use yet.

---

## 11. Open questions (need your call before the relevant step)

1. **Production data?** Is there a live install with real bills? This decides between the
   full DB rename and the `@@map` fallback (§2.1), and whether the DB name changes.
2. **Patient fields:** add age, sex, phone, referring doctor (§2.2)? Required or optional?
3. **UI words for:** Operator role ("Front Desk"?), Category ("Billing Type"?), Company
   ("Panel / Corporate"? "TPA"?), Location ("Branch" / "Collection Centre"?).
4. **TAT model:** plain hours is fine for v1? Or do tests have cut-offs/fixed report
   times ("sample by 11 AM → report 6 PM same day"), or does the lab close on
   Sundays/holidays?
5. **Where does TAT count from:** the sample collection time (as proposed) or always the bill time?
6. **Quotation:** optional (proposed) or mandatory before every bill? Default validity period?
   Should a quote reserve its price even after the catalog price rises (proposed: yes, while valid)?
7. **Panels/profiles:** does POS need to know which tests make up a panel, or is a
   panel just a priced catalog entry for now (proposed)?
8. **Single-test cancellation / partial refund:** needed soon? This is the one item
   that would touch the money layer, so better to know early.
9. **Test catalog size and source:** roughly how many tests, and is there an existing
   list (Excel/CSV) to import?
10. **Per-test discount** or bill-level only (proposed: bill-level only, as today)?
11. **Bulk test import (§6.7):** start with a one-off import script (proposed), or build a
    CSV upload screen on the Tests tab from day one?
12. **My Bills with tests (§6.5):** an expandable row per bill (proposed) or extra columns
    on an already 12-column table?
13. **Printed bill / quotation header (§6.6):** what has to be on it: lab name, address,
    phone, GSTIN, logo, per-branch details, footer text (e.g. "reports collectable after…")?
