# Pivot: Payment Tracking System → Laboratory Management System

Status: **Phase 1 built: Steps 0–7 done (2026-10-27), awaiting your review; plan revision 3.7.** Rounds 1 and 2 were reviewed in
`pivot_review.txt`; rounds 3–8 arrived in chat. Every answer is applied below and
traced in the decision log (§14). Remaining questions are in §15.

What we built so far (a payment tracking POS) was demoed, and the brief is now a
full **Laboratory Management System**. **The app is not live**: there is no production
data, so renames and schema changes can be done cleanly, with no data migration.

---

## 1. Phase 1 scope

Phase 1 delivers a solid **test catalog, quotation and billing system**. Later phases
cover what happens after billing: sample processing, results, reports and the TAT engine.

| In Phase 1 | Later phases (§10) |
|---|---|
| Lab settings; role hierarchy (lead pathologist → pathologist → technician); lead hand-over | Lab calendar (open / closed / half days, machine availability) and its approval rules |
| Branches, collection centres (each linked to a processing branch), home visits (per-location minimum charge) | Machine availability, downtime, calibration (uses the calendar) |
| Patients with required demographics | TAT engine (computed report times, §10.3 scenarios) |
| Referring doctors (added by technicians, approved by the lead) | Pathologist availability schedules |
| Payers: self or panel; **panel price lists (TPA / insurer) and scheduled company camps** | Sample processing workflow, result entry, **report generation** |
| Catalog: **tests, profiles (with their component tests), services** (e.g. home visit), each test's **machine steps**; entered in a grid, approved by the lead | Report holds **enforced** (Phase 1 records and shows them, §4.2) |
| Machine types and machines registry (for the catalog; availability comes later) | |
| Quotations: 48 h validity, reserved prices, thermal print (Zebra GT820), barcode | Sample tube barcode labels on the same GT820 (§10.4) |
| Bills, payments, panel settlement, a manually entered "report expected by" per bill | |
| **Cancelling a single test with partial refund** (needed from day 1) | |
| **Approvals**: discounts, cancellations and patient corrections (pathologist or lead); catalog changes and new doctors (lead) | |
| Sample collection now or on a revisit, recording the revisit | |
| Day Sheet (replaces My Bills), A4 printing, document verification | |
| Analytics adapted to the new model | |

---

## 2. Guiding principle: change the money layer once, deliberately

Cancelling one test and refunding part of a bill is needed from day 1, so the money
layer changes (§4.10). The rules that stay:

- All amounts are integer paise on the server. The client only displays them.
- Every write that changes a bill's money locks the bill row first (`SELECT … FOR UPDATE`),
  as payments, settlement and refunds already do (BUG-011).
- Bill-level totals stay the thing every report reads:
  `originalAmount / discountAmount / netAmount / balance`.

Totals are now **derived from line items and money movements**, never typed in.
**Approving doesn't move money**: a discount or cancellation takes effect immediately, and
approving it only clears a report hold. The one exception is a **rejected discount**: it's
reverted, so the patient owes the full amount again (§4.2).

---

## 3. Naming, roles and organisation

### 3.1 Renames (full depth: schema, API, code, UI)

| Today | Becomes | Notes |
|---|---|---|
| Payment Tracking System | Laboratory Management System | Everywhere: titles, `package.json`, scripts, docs. DB `payment_tracking` → `lab_management`. |
| Client | **Patient** | Gains required fields (§4.4). |
| Operator (role) | **Technician** | |
| Admin (role) | **Lead pathologist** takes over its duties | Branches, panels, rates, reassignment, analytics, machines, approvals. |
| Category | **Removed.** Replaced by **Referral** + **Payer** (§4.5) | |
| Company | **Panel** (corporate, TPA, insurer), with its own rates | Now the *payer* on a bill. |
| Location | **Branch** or **Collection Centre** | Each has its own location code (bill-number prefix). Codes are now **unique**; the old design let locations share one. |
| My Bills | **Day Sheet** (§6.7) | |

Since nothing is live, migrations are **squashed into one fresh `init` migration** (as
`scripts/consolidate-migrations.ps1` did before). Raw SQL in `analytics.js` is updated in
the same pass.

### 3.2 Roles

```
developer          installation and support only: first-run setup (lab settings + the first lead's account).
                   Creates no other accounts. Can re-appoint the lead only after 7 days of lead
                   inactivity (§3.3).
lead_pathologist   exactly one; everything a pathologist can do, plus: the ONLY role that creates and manages
                   user accounts (pathologist, technician, accountant); applies catalog changes directly and
                   approves others'; approves doctors; manages branches, panels/rates, machines, lab
                   name/contact; reassignment; analytics; hand-over
  └ pathologist    many, including visiting / part-time staff. Can do everything at reception a technician can
                   (covers when technicians are on leave), approves discounts, cancellations and patient
                   corrections (own included), proposes catalog
                   changes (applied only after the lead approves), approves reports in a later phase
      └ technician data entry: patients, quotations, bills, payments, samples; proposes catalog changes,
                   doctors and patient corrections
accountant         read-only; tallies all money daily, weekly and monthly for audit: analytics + PDF export,
                   any Day Sheet (§6.10)
```

**Account management is the lead's.** Creating accounts and managing them afterwards
(deactivation, password reset) move from the developer page to the lead. The developer
creates only the first lead during first-run setup.

`admin` and `operator` are removed from the `Role` enum. Promote Operator goes away.
Reassign Operator becomes **Reassign Technician** (lead only), with the same append-only audit table.

### 3.3 Lead pathologist hand-over

- **Exactly one lead.** A partial unique index allows only one active `lead_pathologist`.
- The **developer appoints the first lead** during first-run setup (§3.4).
- After that, **the lead hands over to one of the current pathologists**. The confirm dialog
  says plainly: *"You are making X the lead pathologist. Your own account will become a
  pathologist account."* In one transaction: X becomes lead, the current lead becomes
  pathologist, and a `LeadTerm` history row closes / opens.
- A former ("retired") lead **keeps signing in, with exactly a pathologist's rights**. Their
  history (approvals, terms as lead) stays attributed to them.
- **If the lead is unreachable** (round 4): once the lead hasn't signed in for **7 days**,
  the developer may appoint one of the current pathologists as lead. It's the same
  transaction as a hand-over: the old lead becomes a pathologist, and the `LeadTerm` row
  records that the developer made the appointment and why. Before 7 days have passed, the
  server refuses it.

### 3.4 Lab settings

A single-row `LabSettings` table: **lab name, contact details (phone, email, address)**.
The developer fills it in on first run, together with appointing the first lead. A
first-run screen on the developer page appears while `LabSettings` is empty. After that,
**only the lead pathologist** can change name and contact. These values head every print (§7).

---

## 4. Data model (prisma/schema.prisma)

Sketches show intent, not final syntax. UUID keys, `timestamptz` timestamps and soft
deletion (`isActive`) everywhere history refers to a row.

### 4.1 Users

`Role` enum: `developer | lead_pathologist | pathologist | technician | accountant`.
`lastLoginAt` is set on every sign-in and drives the 7-day rule (§3.3).
`LeadTerm { userId, startedAt, endedAt?, appointedById, reason: handover | inactive_lead }`
records who was lead, when, and how they were appointed.

### 4.2 Approvals and report holds (one table, one queue)

Two kinds of approval exist. One table and one queue screen handle both:

| Subject | Takes effect | Who approves | While pending or rejected |
|---|---|---|---|
| Catalog change: add / edit / retire a test, profile, service | **on approval** | lead | nothing changes in the catalog |
| Referring doctor (new) | **immediately**: usable on bills | lead | **report hold** on every bill naming that doctor |
| Patient correction (a mandatory field) | **on approval** (round 7) | pathologist or lead | nothing changes: the patient's current details stand |
| Bill discount (any discount, even 100%; at billing or at payment time) | **immediately** | pathologist or lead, **own included** | **report hold** on the bill |
| Test cancellation (and the refund it caused) | **immediately** | pathologist or lead, **own included** | **report hold** on the bill |
| Calendar day (later phase) | on approval | another pathologist; the lead's apply directly | — |

```prisma
model Approval {
  id            String   @id @default(uuid())
  subjectType   ApprovalSubject  // catalog_change | referring_doctor | patient_correction | bill_discount | bill_cancellation | (later) calendar_day
  subjectId     String?          // the doctor / bill / cancellation; null for a catalog "add"
  billId        String?          // set for bill holds, so a bill's holds are one query
  payload       Json?            // catalog: proposed values. discount: old → new amount. cancellation: items, refund.
  status        ApprovalStatus   // pending | approved | rejected | resolved (a rejected cancellation the lead has dealt with)
  requestedById String
  requestedAt   DateTime @default(now()) @db.Timestamptz(3)
  reviewedById  String?
  reviewedAt    DateTime? @db.Timestamptz(3)
  reviewNote    String?
}
```

- **Report holds**: a bill's report can be generated only when none of these apply:
  - a discount or cancellation approval on the bill is **pending**
  - a discount was **rejected** and the bill's balance isn't 0 yet (the hold lifts once it's
    paid in full)
  - a cancellation was **rejected** and the lead hasn't marked it **resolved**
  - the bill names a referring doctor who isn't approved yet

  **Phase 1 records and displays holds** (a "Report on hold" tag listing the reasons, on the bill and the
  Day Sheet). Report generation itself, which enforces them, comes later.
- The discussion with the patient happens offline. The approval records that it took place.
- A catalog approval applies its payload in the **same DB transaction** that marks it approved.
- **Self-approval** (round 4): a discount or cancellation entered by a pathologist or the
  lead is recorded as approved by them when it's entered (`reviewedById = requestedById`,
  flagged self-approved), so no second approval is needed. One entered by a technician waits
  for a pathologist or the lead. The same applies to patient corrections: a technician's waits
  for a pathologist, while a pathologist's or the lead's applies directly (assumed, by analogy
  with discounts; say if not). Catalog changes and doctors still need the lead.
- **Rejections** are rare, because everything is discussed offline first (round 4):
  - **Discount rejected:** the discount is reverted in the same transaction (bill row locked),
    so the bill shows the full amount due. The report stays held **until the full amount is
    paid**, and the hold then lifts on its own.
  - **Cancellation rejected:** the refund has already been given, so the hold stays until the
    lead deals with it (e.g. by re-billing the test) and marks the approval **resolved** with a note.
  - **Doctor rejected:** the doctor is dropped from every bill naming them (the referral stays
    "doctor", with no doctor named). That clears the hold, and each bill's history records the change.

### 4.3 Locations: branches, collection centres, home visits

```prisma
enum LocationType { branch  collection_centre }

model Location {
  // existing: id, name, locationCode, isActive
  // locationCode: 2 digits, now @unique (one code per branch/centre; previously shareable)
  type             LocationType
  address          String           // printed on quotations and bills
  phone            String?
  processingBranchId String?        // required for a collection centre: where its samples are processed
  homeVisitCharge    Decimal?       // minimum home-visit charge for visits from this location
}
```

Each bill records where the patient was served. `collectionMode` is `at_location` or
`home_visit`, with `locationId` = the branch or centre handling it. For a home visit:

- **The visit address is optional.** Some patients don't want it stored.
- **The home-visit charge varies by branch/centre** (round 4). Each location has a fixed
  `homeVisitCharge`. Choosing "home visit" adds a home-visit line (a catalog service item)
  priced at that amount. The technician may **raise** it but never lower it, and the server
  enforces the minimum. Any reduction can only come through the bill discount, which goes
  through approval.
- The "Home visit" catalog item exists only to give the line a code and name. **Its catalog
  price is never used.**
- A location with **no `homeVisitCharge` set doesn't offer home visits**: the option is hidden
  for it.
- **Quotations can include a home visit too**, priced the same way (§4.9).

### 4.4 Patients

| Field | Rule |
|---|---|
| `name` | required |
| `dateOfBirth` + `dobIsApproximate` | required. Typing an age stores an estimated DOB flagged approximate, so the current age is always computed. A bill shows the age **as of the bill date, computed from the current DOB**, so a corrected DOB shows on old bills too. |
| `sex` | required: male / female / other |
| `phone` | required |
| `patientNumber` | **derived from the mandatory fields** (round 5), **re-derived whenever one is corrected** (round 6): see below. All numeric. Printed on **bills and reports** only (round 6). |

- More fields will follow after feedback. Fields added later are **not** part of the patient
  number, so the number stays derivable from the original mandatory four.
- No find-or-create by name. The picker searches name, phone or patient number and shows
  `name · age/sex · phone`. "New patient" opens a short form.

**Patient number derivation.** It's for **catching duplicates and faster searches** (round 6).
The number is one anyone holding the mandatory fields can work out again, rather than an
arbitrary id.

1. **Normalise** the fields:
   - name: upper-case, single spaces, punctuation dropped
   - date of birth: an approximate DOB counts as its birth year only
   - sex: M / F / O
   - phone: last 10 digits
2. **Hash** them together (SHA-256) and read the result as a number: **12 digits plus one check
   digit** (Luhn), so a mistyped number is caught. That's 13 digits, no letters.
3. **Same details → same number**, at any branch, any time. Registering someone who already
   exists produces their existing number, and the form opens the existing patient instead.
4. **Duplicates can't be entered** (round 7). Two records with the same full name, age, sex
   and phone are the same person, so they're never allowed. The database enforces this, not
   just the form: each patient stores an `identityKey` (the normalised fields from step 1)
   with a **unique index**, so even two technicians registering the same person at the same
   moment get one record. There is no merge feature, because there is nothing to merge.
5. **One-way:** the number reveals nothing about the patient (no phone digits on documents).
   It can only be recomputed by someone who already has their details.

Limits worth knowing:

- **A number clash isn't a duplicate.** Two *different* people (different details) could
  still hash to the same 12 digits. At ~100,000 patients the chance of any such clash is
  about 1 in 200. The server detects it (same number, different `identityKey`) and gives the
  newer patient the next free number. That one patient's number is then not derivable. Old
  numbers kept as aliases count as taken.
- **What the unique index can't see:** the same person entered with different details. A
  spelling variant ("Mohd" / "Mohammed"), or an age given a year later (a different birth
  year), produces different normalised fields. To stop these at the counter, the form keeps
  the **name + phone look-alike warning**: entering a phone that already belongs to a
  patient with a similar name shows that patient first. The technician picks them, or
  confirms it's a different person (e.g. a family member sharing the phone).

**Correcting a mandatory field** (rounds 6–7). A technician **proposes** the correction,
which becomes a `patient_correction` approval. **Nothing changes until a pathologist (or
the lead) approves it**. Until then the current details stay on everything. A pathologist's
or the lead's own correction applies directly (§4.2). There's one pending correction per
patient at a time. Approval runs as one transaction:

1. The patient row is updated and the number is **re-derived** from the corrected details.
2. **Historic bills and reports show the corrected details and the new number.** Bills
   reference the patient and never copy name, sex, phone or DOB, and the age on a bill is
   computed from the current DOB as of the bill date. The quotation's free-text name/phone,
   from before a patient existed, is the one exception: it's what was quoted.
3. **The old number becomes an alias**
   (`PatientNumberAlias { patientId, number, retiredAt }`). Searching or typing an old number
   still finds the patient, because printouts already handed out can't be updated.
4. **Every change is audited** (`PatientChange { patientId, field, oldValue, newValue,
   changedById, approvedById, changedAt }`). The Verify screen shows "patient details corrected on <date>"
   when an old printout no longer matches the current details, so a genuine old bill isn't
   mistaken for a forgery.
5. **A correction that would make the patient identical to another patient** (same
   `identityKey`) is refused: duplicates are never allowed (round 7). It's checked both
   when the correction is proposed and again at approval, since another patient could have
   been registered or corrected in between. The screen shows the other patient.

### 4.5 Referral and payer (replaces Category / Company)

Who referred the patient and who pays are separate questions. Every bill answers both:

| | Options | On the bill |
|---|---|---|
| **Referral** | `walk_in` · `doctor` | `referralType`, `referringDoctorId?` (**optional**, even for a doctor referral) |
| **Payer** | `self` · `panel` (corporate / TPA / insurer) | `payerType`, `panelId?` (required when `panel`), `campId?` (a scheduled camp of that panel) |

**Referring doctors.** `ReferringDoctor { name, phone, clinic/hospital, status: pending | approved | rejected, isActive }`.
- Technicians add doctors on a **separate Doctors screen**, not from the bill form. A new
  doctor is pending until the lead approves.
- Bills can name a pending doctor. That bill's report is held until the doctor is approved (§4.2).

**Panels, price lists and camps.** `Panel` is today's `Company`: name, type, contact,
`isActive`. Special rates come in two forms, and both use the same `PriceList` shape:

- **A standing price list on a panel** (round 5): a TPA or insurer can have its own price
  catalog. It applies to every bill that panel pays for, with no end date.
- **A camp** (round 4): its own record, a company-led event scheduled for a period, with a
  price list that applies only inside that period.

```prisma
model PriceList {
  discountPercent  Decimal?          // % off catalog price for every item not listed
  items            PriceListItem[]   // { catalogItemId, price }: custom price per test/profile
}

model Panel { …, priceListId? }       // standing rates, e.g. an insurer's own catalog

model Camp {
  panelId                             // the company running the camp
  name, venue?                        // e.g. "Acme health camp", "Acme plant, Pune"
  locationId                          // the branch/centre conducting it
  startsAt, endsAt                    // the scheduled period
  priceListId                         // the camp's rates, applied only inside the period
  createdById                         // the lead
}
```

- Only the lead edits price lists and camps.
- **A quote or bill under a camp always uses the camp's branch/centre** as its location.
- **Rates are prices, not discounts**, so bills priced by them need no per-bill approval. An
  extra bill discount on top still does.
- Editing a standing price list affects new quotes and bills only. Existing ones keep their
  snapshotted prices, and an open quote keeps its reserved price (§4.9).

**Panel settlement** (today's company settlement) carries over as-is: pick the panel, tick
the bills to close.

### 4.6 Catalog: tests, profiles, services; machines

~150 items. They load once, and search runs in the browser.

```prisma
enum CatalogKind { test  profile  service }

model CatalogItem {                 // "LabTest" in revision 2
  code, name, kind, price
  department?, sampleType?, container?, instructions?   // tests/profiles; services have none
  status        active | retired    // proposals live in Approval until approved
  draws         CatalogDraw[]       // sample draws, in order: ≥1 for tests; none for profiles or services
  machineSteps  CatalogMachineStep[] // tests: which machine types, in order (for TAT later)
  components    ProfileComponent[]  // profiles: the tests it covers
}

model CatalogDraw        { itemId, sequence, label }              // "Single"; GTT: "Fasting", "1 h", "2 h"
model CatalogMachineStep { itemId, sequence, machineTypeId }      // same sequence number = parallel
model ProfileComponent   { profileId, testId }                    // e.g. Lipid Profile → 5 tests

model MachineType { name }                                        // "Haematology analyser"
model Machine     { name, machineTypeId, branchId, isActive }     // a physical unit at a processing branch
```

- **Grid columns (catalog entry):** code, name, kind, department, sample type, container,
  price, draws (tests only), **machines required** (review R2 Q10), patient instructions; for profiles,
  **component tests**.
- Every addition or edit by a technician or pathologist is an `Approval` (catalog_change),
  applied when the lead approves. The lead's own changes apply directly.
- Bills and quotes snapshot code, name and price, so old documents never change.
- **A test lives on its own and inside profiles** (round 4). It's always a standalone catalog
  item with its own price, and any number of profiles can include it (`ProfileComponent`
  is many-to-many).
- **Overlap warning** (round 4): if a quote or bill holds a profile *and* one of its tests
  separately, or two profiles sharing a test, the form warns before saving, since the test
  would be billed twice.
- **Profiles are cancelled whole** (round 4), never one component at a time.
- **Sample draws are test-level only** (round 5). Profiles have no draws of their own, and
  nothing is derived or merged for them. A profile line on a bill carries each of its
  tests' draws separately. When a sample is taken, the technician marks exactly which tests
  it covers (one, several, or all but one), and the rest stay pending for a revisit.
- A test requires a **machine type**, not a particular unit (confirmed in round 4). Any
  machine of that type at the processing branch can run it, which lets a backup take over
  (T4). Machines belong to branches, and steps sharing a sequence number run in parallel
  (both confirmed). Availability is calendar work, in a later phase.

### 4.7 Pricing (one function)

```
price(item, payer, camp, location, at) =
  home-visit line:                          max(location.homeVisitCharge, amount entered by the technician)
  billed under a camp of that panel,
    with `at` inside its scheduled period:  from the camp's price list
  payer is a panel with a standing list:    from the panel's price list
  otherwise:                                catalog price

from a price list = its custom price for the item if listed,
                    otherwise catalog price − its discountPercent (or catalog price if it has none)
```

A running camp beats the panel's standing list.

The quote and bill forms both call it. Each line snapshots the result, so the quoted or
billed price never changes later. **A camp's scheduled period is checked when a quote is
issued and when a bill is created directly**, and the server refuses either outside it.
Converting a quote that's still within its 48 h keeps the quote's camp prices, even if the
camp has ended since (§4.9).

### 4.8 Bills, line items, samples

```prisma
model Bill {
  // kept: billNumber ({locationCode}{YY}{MM}{seq}), createdBy, createdAt, location, reassignments
  patientId                              // patient details are read live, never copied (§4.4)
  referralType, referringDoctorId?, payerType, panelId?, campId?
  collectionMode, homeVisitAddress?
  quotationId?          @unique
  expectedReportAt      DateTime?        // one per bill, entered manually in Phase 1
  verificationCode      String @unique   // random; printed as a barcode (§7.3)
  status                pending | fully_paid | cancelled
  items BillItem[]
}

model BillItem {
  billId, catalogItemId, code, name, kind, price     // snapshots
  status            active | cancelled
  processingStatus  not_started | in_progress | completed   // set by the processing phase; always not_started in Phase 1
  cancellationId?
  collections       SampleCollection[]               // one per draw of each test (a profile: each component test's draws)
}

model SampleCollection {
  billItemId, testId, sequence, label               // testId = the line's own test, or a component of its profile
  status   pending | collected
  dueAt?                                            // revisit: when the patient is expected back
  collectedAt?, collectedById?
}
```

- `originalAmount = Σ price of active items`, computed by the server.
- **Profiles are one billed line.** Their component tests matter for processing and reports
  (later phases), and the bill's print lists them under the profile.
- At billing, **each test's** draws are marked **collected now** or **due at**. For a profile,
  every component test is listed separately, so part of a profile can be collected now and
  the rest on a revisit. A revisit = pending `SampleCollection` rows with a `dueAt`. Recording
  the revisit marks the chosen tests' draws collected (who, when).
- **Report expected by**: one date-time per bill, entered manually (review R2 Q14).
  The TAT engine (later phase) will compute it.

### 4.9 Quotations

```prisma
model Quotation {
  quoteNumber       String @unique    // Q + locationCode + YY + MM + seq (existing counter, "Q" key)
  verificationCode  String @unique    // random; printed as a barcode
  patientId?, patientName, patientPhone?     // a patient row is created only on conversion
  locationId                          // issuing branch/centre (its address is printed)
  collectionMode                      // at_location | home_visit: a home visit adds the home-visit line (§4.3)
  createdById                         // issuing technician/pathologist (printed)
  referralType, referringDoctorId?, payerType, panelId?, campId?
  originalAmount, discountAmount, netAmount
  issuedAt, validUntil                // validUntil = issuedAt + 48 h
  status  open | converted | cancelled          // "expired" = open && now > validUntil
  items   QuotationItem[]             // catalogItemId + code/name/kind/price snapshots
}
```

- **Optional**: a bill doesn't need a quotation.
- **Within 48 h**: converts at the **quoted prices**, even if the catalog changed since or
  the quote's camp has ended (§4.7).
- **After 48 h**: if every line's quoted price **still equals today's price** (§4.7, same
  payer), the same quote can still be converted. If any price changed, it must be
  **re-issued**: a new quote, new number, current prices, a fresh 48 h. The old one stays as history.
- Converting locks the quote, checks it, creates the bill through the shared billing
  service, and marks the quote converted. A second conversion fails cleanly (`@unique` on
  `Bill.quotationId`).
- A quote's discount is only a proposal. The approval is created on the **bill** when the
  quote is converted.

### 4.10 Money movements: payments, cancellations, refunds

```prisma
model Transaction  { … a payment, as today (amount, extra discount, mode, who) … }
model Cancellation { billId, reason, createdById, createdAt, items BillItem[], refund Refund? }
model Refund       { billId, cancellationId, amount, mode, createdById, createdAt }
```

Derived values (one service function, used everywhere):

```
originalAmount = Σ active item prices
netAmount      = originalAmount − discountAmount
collected      = Σ payments − Σ refunds
balance        = netAmount − collected
status         = cancelled if no active items; fully_paid if balance = 0; otherwise pending
```

**Cancelling tests**, in one DB transaction with the bill row locked:

1. **Refuse** if any chosen item's `processingStatus` isn't `not_started`. A test that has
   started, or has results in the system, can't be cancelled (review R2 Q8). Phase 1 has
   no processing yet, so the rule is enforced from the first day and simply starts biting
   once processing exists.
2. Mark the items cancelled and recompute `originalAmount`. The discount is bill-level:
   the dialog shows it, defaulting to `min(discount, new subtotal)`. The technician confirms
   it, and a changed discount raises its own discount approval.
3. If `collected > netAmount`, record a `Refund` for the difference (mode chosen in the
   dialog). A panel bill with nothing collected just has its balance reduced.
4. Create the **cancellation approval**. The bill's report is held until a pathologist or
   the lead approves it. It's self-approved when a pathologist or the lead did the
   cancelling (§4.2).
5. **Whole-bill refund** = cancel all items, the same path. The old refund route and the
   `refundedAmount/refundedAt/refundedById` columns go away.

**Discounts**: any amount, up to 100%, at billing or later (payment-time extra discount or
an edit). Each discount change creates a **discount approval** and holds the report until
it's approved: self-approved when a pathologist or the lead enters it, reverted if rejected (§4.2).

Analytics: daily "collected" = payments − refunds that day. **Refunds** get their own
count/amount column. Billed totals exclude cancelled items. BUG-006 (editing or deleting a
payment) stays parked.

---

## 5. Backend changes (src/)

| Area | Change |
|---|---|
| Schema | Fresh squashed `init` migration with §4; DB renamed `lab_management`. |
| `middleware/auth.js`, all routes | New role names. Pathologists get every technician permission. |
| `services/billing.js` (new) | Patient resolution, pricing (§4.7), bill creation (shared by `POST /bills` and quote conversion), derived totals, cancellation + refund, discount changes, report-hold computation. |
| `services/approvals.js` (new) | Create (self-approving a pathologist's or the lead's own discount, cancellation or patient correction), approve, reject with the round 4 outcomes (revert the discount, drop the doctor, cancellation held until marked resolved). Per-subject rules: who may approve, apply-on-approve vs hold-clearing. |
| `routes/patients.js` | Search (`?q=` name / phone / number, incl. old numbers via aliases), create (derives the number; an exact match returns the existing patient; the unique `identityKey` blocks duplicates; look-alike warning), propose a correction (→ approval; applied on approval: re-derive, alias, audit, duplicate refused). |
| `routes/bills.js` | Create with items, referral, payer, collection mode, draws. `GET /:id` (items, collections, payments, refunds, holds). `PATCH /:id/cancel-items`, `/discount`, `/samples`, `/expected-report`. Reassign (lead). |
| `routes/transactions.js` | Payments as today. A payment-time discount raises an approval. |
| `routes/panels.js`, `routes/camps.js` | Panels with their standing price lists, outstanding bills, settlement; camps with schedule and price list (lead). |
| `routes/doctors.js` | List (approved + pending), propose. Approval goes through approvals. |
| `routes/catalog.js` | Active catalog; propose (single or a grid batch); profiles with components; machine steps. |
| `routes/machines.js`, `routes/locations.js` | Machine types, machines (lead). Locations with type, address, processing branch. |
| `routes/approvals.js` | The queue (filtered by what the caller may approve), approve / reject with a note, mark a rejected cancellation resolved (lead). |
| `routes/quotations.js` | Create, list, get, cancel, convert (incl. the expired-but-unchanged rule), re-issue. |
| `routes/verify.js` | `GET /api/verify/:code` → the quote or bill it belongs to. |
| `routes/settings.js`, `routes/users.js` | Lab settings (lead); first-run setup (developer: lab settings + first lead, only while empty); user accounts: create, deactivate, reset password (**lead only**); lead hand-over; developer re-appointment of the lead after 7 days of lead inactivity (`lastLoginAt`). |
| `routes/analytics.js` | Technician-wise, branch-wise, referral-wise (per doctor), payer-wise (per panel), test-wise, refunds, pending approvals. |

---

## 6. Screens (React + TypeScript + Ant Design, §12)

### 6.1 Catalog

- **Catalog**: a searchable table of active items (everyone), with profiles showing their tests.
- **Add / edit items (technician, pathologist)**: an **editable grid with the column headers
  already in place** (§4.6). Rows can be filled a few at a time, so the catalog gets built in
  instalments; pasting rows from Excel is supported. Profiles pick their component tests
  from approved tests. Each row becomes a catalog approval.
- **Machines (lead)**: machine types and units per branch.

### 6.2 Approvals (pathologist, lead)

One queue, filtered to what the signed-in user may approve:

- **Pathologist:** discounts, cancellations and patient corrections (old and new values side by side).
- **Lead:** those, plus catalog changes and doctors.

Each entry shows the bill or proposal, who asked and when, plus the values; edits show old
and new values. Approve or reject with a note, one at a time or in bulk. Requesters see the
status of what they submitted.

### 6.3 Doctors

A list of approved and pending doctors, with "Add doctor" (technician or pathologist,
→ pending). The lead approves in the queue.

### 6.4 Quotation

Patient (search, or name + phone), branch/centre + collection mode, referral, payer (+ camp), items
(searchable `Select` + `Form.List`, priced via §4.7), discount, totals, validity shown.
Actions: **Save & print** (Zebra GT820), cancel, **Convert to bill**, **Re-issue** (when expired
and prices changed). Conversion opens Create Bill prefilled.

### 6.5 Create bill and bill detail

- **Create:** patient (search or new-patient form), branch/centre + collection mode
  (home visit → optional address; a home-visit line at the location's charge, which the
  technician may raise), referral (+ optional doctor), payer (+ camp), items (with the
  overlap warning), **sample status per test and draw** (profiles expanded into their tests), discount, report expected by,
  payment now. Then **Print bill (A4)**.
- **Detail:** items with sample status, payments, refunds, **report holds** (with reasons and
  approval status), reassignment history. Actions: payment, **cancel tests** (blocked for
  started tests), change discount, record revisit collection, change expected report time, reprint.

### 6.6 Pending revisits

Patients due back (today first, overdue highlighted). One click records the collection.

### 6.7 Day Sheet (replaces My Bills)

A spreadsheet-style view of **what the signed-in user did on a chosen date** (default
today), in two grids:

- **Money taken:** every payment, refund and panel settlement they recorded that day,
  whichever bill it belongs to (including older bills and other users' bills). Columns: time,
  bill #, patient, kind, amount, mode. **Totals by payment mode** at the bottom, with refunds
  subtracted: the cash hand-over figure.
- **Bills created:** time, bill #, patient, age/sex, items, referral, payer, net, paid,
  balance, status, holds.

The totals come from money movements, not from bills, so a period's tally (§6.10) equals the
sum of its Day Sheets exactly. **Print (A4).** The lead and accountant can open anyone's Day Sheet.

### 6.8 Panel settlement, masters, settings, users

- **Panel settlement:** as today's company settlement.
- **Lead only:**
  - **Panels** with standing price lists, and **camps** (schedule + price list: custom prices, % discount)
  - **Branches & centres**
  - **Lab settings** (name, contact)
  - **Reassign technician**
  - **Hand over lead**
  - **User accounts** (create, deactivate, reset password)
- **Developer:** first-run setup; re-appointing the lead after 7 days of lead inactivity.

### 6.9 Verify document

A search box that takes a scanned barcode (reception has scanners). It shows the quote or
bill the code belongs to: number, date, patient, amount, validity or status. If the patient's
details were corrected after the document was printed, it says so (§4.4).

### 6.10 Analytics (lead, accountant)

Adapted summaries (§5), test-wise and refunds. PDF downloads on A4.

The accountant tallies all money **daily, weekly and monthly** for audit, so the date range
gets presets (**today, this week, this month, last month, custom**). A **tally summary**
covers the chosen period:
- payments by mode
- refunds by mode
- net collected by mode
- outstanding panel balances
- discounts given (approved / pending)

Each period's totals must equal the sum of its Day Sheets.

### 6.11 Patients

- **Search:** by name, phone or patient number, including old numbers kept as aliases.
- **Register:** the same form Create Bill opens, with the duplicate block and look-alike warning (§4.4).
- **View:** a patient's bills and quotes.
- **Propose a correction** to a mandatory field. It applies directly for a pathologist or the
  lead; otherwise it goes to the approval queue (§4.4). A pending correction shows on the
  patient with its status, and only one can be pending at a time.

---

## 7. Printing

| Document | Printer | Layout |
|---|---|---|
| Quotation | **Zebra GT820** thermal barcode printer, continuous fanfold media with ribbon (thermal transfer), shared on the LAN | 104 mm wide, as long as the content, receipt-style, single column, black only, Code 128 barcode |
| Bill, Day Sheet, revisit list, analytics PDFs | **HP, A4** | Normal A4 layout with tables |

### 7.1 How: browser printing for everything

Round 4 corrected the quotation printer: it's a **Zebra GT820 thermal barcode printer**, not
a dot-matrix, on continuous fanfold media and shared on the LAN. Printing stays **in the browser**
(round 3), through Zebra's Windows driver (ZDesigner).

- Each printable document has a **print route** rendering a print-only layout with its own CSS:
  - **Quotation** (`/print/quotation/:id`): the GT820 prints at **203 dpi** with a maximum
    print width of **104 mm** (confirmed in round 5), on **continuous fanfold** media with a ribbon
    (thermal transfer). The quotation is a **narrow, receipt-style** document: one column,
    one item per line, then totals, and a footer with validity terms and barcode.
    **The page is as long as the quotation** (round 6: the 300 is the ribbon's maximum size,
    not a page limit). CSS can't size a page to its content on its own, so the print view
    **measures the rendered quotation and sets `@page { size: 104mm <measured height> }`**
    just before calling `window.print()`. The ZDesigner driver must be set to continuous
    media so it accepts that length. This gets **verified on the real GT820 in Step 5**.
    Fallback if the driver won't take a custom length: a fixed page length, with totals,
    validity terms and barcode kept together on the last page.
  - **A4 documents** (`/print/bill/:id`, `/print/day-sheet?date=`, …): `@page { size: A4 }`.

  The print button opens the route and calls `window.print()`.
- **Driver setup, once per PC:** set the ZDesigner driver to **104 mm wide, continuous
  media**. Only the width is fixed; the length varies per quotation (above). A wrong width
  makes Chrome scale the page.
- **Choosing the printer:** the browser can't pick a printer itself. Staff choose the GT820
  for quotations and an HP for everything else in the print dialog, and Chrome remembers
  the last printer used. The two layouts look nothing alike, so a quotation sent to the HP
  (or a bill to the GT820) shows up straight away.
- Thermal output is black-only and sharp. The layout avoids greys and fills, which thermal
  printers render as dithering.
- The analytics "Download PDF" buttons (jsPDF, A4) stay as they are.

### 7.2 What's printed

- **Header (all documents):** lab name and lab contact (from `LabSettings`); **address and
  phone of the branch/centre** that issued the document.
- **Quotation:** quote #, issued date-time, **name of the technician who issued it**,
  patient, referral, payer, items (profiles with their tests, patient instructions),
  subtotal, discount, net. **Footer:** validity terms ("Valid for 48 hours, until
  <date time>") and the **verification barcode**.
- **Bill (A4):** the same header, plus bill #, date-time, technician, patient (name,
  age/sex, phone, **patient number**: all current, §4.4), referral, payer, items (cancelled ones shown
  as cancelled), subtotal, discount, net, paid by mode, refunds, balance, **report expected
  by**, **pending sample visits**, patient instructions, **verification barcode**.
- **No tax information anywhere** (review R2 Q16).
- Report holds are internal. They never appear on patient-facing prints.

### 7.3 Verification barcode

- Each quote and bill gets a random, unguessable `verificationCode` (e.g. 12 characters).
  It's never the sequential number.
- Printed as **Code 128** (JsBarcode) with the code in readable text underneath, on both
  printers. Thermal bars print crisply. Render the barcode at the GT820's native 203 dpi so
  bars aren't resampled, and still **test print and scan early on the real GT820**. The
  readable text lets staff type the code in if a scan fails.
- Scanning it in Verify Document shows the record from the database. A forged or altered
  printout won't match.

---

## 8. Roles and permissions (Phase 1)

| Capability | technician | pathologist | lead | accountant | developer |
|---|---|---|---|---|---|
| Patients, quotations, bills, payments, revisits, cancellations, discounts | ✓ | ✓ | ✓ | — | — |
| Panel settlement | ✓ | ✓ | ✓ | — | — |
| Own Day Sheet | ✓ | ✓ | ✓ | — | — |
| Any Day Sheet | — | — | ✓ | ✓ | — |
| Propose catalog changes, add doctors | ✓ | ✓ | applies directly | — | — |
| Approve discounts and cancellations (own included) | — | ✓ | ✓ | — | — |
| Propose a patient correction | ✓ | applies directly | applies directly | — | — |
| Approve patient corrections | — | ✓ | ✓ | — | — |
| Approve catalog changes and doctors | — | — | ✓ | — | — |
| Panels, price lists and camps, branches (incl. home-visit charge), machines, lab name/contact | — | — | ✓ | — | — |
| Reassign technician, hand over lead | — | — | ✓ | — | — |
| Analytics + PDF, period tally (daily / weekly / monthly) | — | — | ✓ | ✓ | — |
| User accounts: create, deactivate, reset password | — | — | ✓ (only) | — | — |
| First-run setup (lab settings + first lead) | — | — | — | — | ✓ (only while empty) |
| Re-appoint the lead from the pathologists | — | — | (hand-over) | — | ✓ (only after 7 days of lead inactivity) |

Every route's permissions get cases in `e2e/specs/auth/api-permissions.spec.js`.

---

## 9. Out of scope for Phase 1

Everything in §10, plus: result entry, report generation (and so the *enforcement* of
report holds), report approval by pathologists, editing or deleting a recorded payment
(BUG-006), visit address management beyond the optional field.

---

## 10. Later phases: calendar, machines, TAT

Captured now so Phase 1's data model doesn't block it.

### 10.1 Lab calendar

- Per date: **open / closed / half day** (hours), plus **which machines are available and
  when** (calibration, half days, maintenance).
- Edited **only by pathologists**. A pathologist's change needs approval from **another**
  pathologist; the lead's apply directly. This uses the Phase 1 `Approval` table.
- Once it exists: revisit dates and quote validity can respect closed days, and TAT reads it.

### 10.2 Pathologist availability

Visiting, part-time, specific days/weeks/months or custom periods. Not needed for TAT
(T17 is invalid: a pathologist is always present while the lab is open). It still
matters for scheduling and report approval later.

### 10.3 TAT scenarios (validated in round 2)

| # | Scenario | Decision |
|---|---|---|
| T1 | **Run cut-off times**: samples received after a cut-off wait for the next run (e.g. "by 11 AM → same-day report"). | valid |
| T2 | **Batch-only tests**: some tests run only at fixed times or on certain weekdays (e.g. twice a week), regardless of when the sample arrives. | valid |
| T3 | **Closed days and half days**: TAT pauses on closed days; on half days some tests can't run at all because their machines are down. | valid |
| T4 | **Machine downtime**: calibration, maintenance or breakdown moves the test to a backup machine or delays it. | valid |
| T5 | **Machine time windows**: a machine available only during certain hours of the day. | valid |
| T6 | **Parallel vs sequential**: tests on different machines run in parallel; tests on the same machine queue one after another. | valid |
| T7 | **Multi-machine tests**: a sample passes through several machines in sequence (e.g. pre-treatment, then analysis). | valid |
| T8 | **Machine capacity / queue length**: a full queue on a busy day pushes later samples back. | **invalid**: the machine stays on until all collected samples are processed |
| T9 | **Multiple draws**: the TAT starts from the *last* required sample (e.g. glucose tolerance at 0, 1 and 2 h). | **valid with a nuance**: TAT is from the last collected sample, but each sample is processed as soon as it's collected, never kept waiting |
| T10 | **Fasting and timed samples**: a fasting sample can only be taken the next morning, so collection, and therefore TAT, starts later. | valid |
| T11 | **Collection centre transport**: samples from a centre reach the processing branch only at scheduled pickup times. | valid |
| T12 | **Home visits**: collection time is the visit slot, and transport follows as in T11. | valid |
| T13 | **Outsourced tests**: sent to an external lab with that lab's own TAT plus courier time. | valid |
| T14 | **Culture / incubation tests**: 24–72 h incubation, possibly a preliminary and a final report. | valid |
| T15 | **Reruns**: QC failure, an abnormal result needing confirmation, or a rejected sample (haemolysed, insufficient) needing recollection. | valid |
| T16 | **Reflex tests**: one result triggers another test (e.g. abnormal TSH → FT3/FT4), extending the bill's TAT. | valid |
| T17 | **Pathologist sign-off**: the report waits for an available pathologist (visiting schedules). | **invalid**: while the lab is open a pathologist is always present; lunch breaks are not worth modelling |
| T18 | **Report collection hours**: a report ready after the branch closes is only available the next opening time. | valid |
| T19 | **Urgent / STAT priority**: jumps the queue, with a shorter TAT. | valid |
| T20 | **Sample stability**: if a sample isn't processed within its stability window, it must be recollected. | valid |
| T21 | **Reagent stock-out**: a test can't run until stock arrives. | valid, but never occurs: **not modelled** |
| T22 | **Bill-level ETA**: a bill's report time is the latest of its tests, unless partial reports are released per test. | valid |

**What this means for the TAT design** (the inputs the TAT phase will add):

| Where | New inputs | Scenarios |
|---|---|---|
| Catalog item | machine-type steps (**Phase 1 already**), run schedule (cut-offs, batch days), incubation and preliminary/final stages, outsourced partner + external TAT, stability window, STAT option + STAT TAT | T1, T2, T6, T7, T13, T14, T19, T20 |
| Calendar | open/closed/half days with hours; machine availability windows and downtime | T3, T4, T5, T18 |
| Location | centre pickup schedule; branch report-collection hours | T11, T12, T18 |
| Processing events | each draw processed when collected, test TAT from the last draw; reruns, recollections and reflex tests recompute the ETA; bill ETA = latest test, with per-test release | T9, T10, T15, T16, T22 |
| Not modelled | queue capacity, pathologist availability, reagent stock | T8, T17, T21 |

### 10.4 Sample tube labels

The GT820 is a label printer, the usual choice for **barcoded sample-tube labels**. Once the
processing phase arrives, each `SampleCollection` (§4.8) can print a tube label (patient,
bill, test codes, barcode) on the same printer, and scanning that label can drive processing.
Nothing is built in Phase 1. This is noted so the printer and the per-draw model line up.

---

## 11. Impact on the e2e test pack

- **The old UI specs retire** with the old frontend (§13 Step 1). Their scenarios (double
  submit, settle ticks, stale loads, modal keyboard handling, XSS) are re-created on the new screens.
- **API-level specs carry over**, updated for the new model: permissions, concurrency, bill
  numbers, money rules, the API half of security-inputs.
- **New specs:**
  - roles and lead hand-over: the outgoing lead becomes pathologist, only one lead
  - pathologist doing reception work
  - catalog grid → approval → active, including profiles and components, rejection, and non-lead attempts
  - doctor pending → bill allowed → hold → approval clears the hold
  - pricing: catalog vs camp (custom price, %, only inside the camp's scheduled period);
    the home-visit minimum per location (raise allowed, lower refused)
  - lead re-appointment by the developer: refused before 7 days of lead inactivity, allowed after
  - self-approval by a pathologist or the lead
  - rejections:
    - a rejected discount reverts, and the hold lifts only once the bill is paid in full
    - a rejected doctor is dropped from their bills
  - profiles: overlap warning (a profile + its own test; two profiles sharing a test);
    profiles cancel whole; a profile collected partly now and partly on a revisit (per-test draws)
  - pricing precedence: running camp > panel's standing price list > catalog
  - patient number:
    - same details give the same number, and registering them again returns the existing patient
    - a hash collision gets the next free number
    - a correction re-derives the number, and the old number still finds the patient
    - an old bill shows the corrected details
    - a correction that clashes with another patient is refused, at proposal and at approval
    - a technician's correction changes nothing until approved; a rejection leaves the patient untouched
    - registering a duplicate is impossible, even with two simultaneous registrations (unique `identityKey`)
    - the look-alike warning appears for a known phone with a similar name
  - discount → hold → approval
  - cancellation: refund, hold, refused for started tests (set `processingStatus` directly in the test DB)
  - cancel all
  - panel settlement after a cancellation
  - quotation: 48 h validity, quoted price honoured, expired-but-unchanged converts, expired-and-changed must re-issue, double conversion refused
  - verification codes
  - home-visit charge
  - Day Sheet totals by mode include payments on older and other users' bills, minus refunds
  - report holds:
    - a rejected discount holds until the balance is 0
    - a rejected cancellation holds until the lead marks it resolved
  - a quote converted within 48 h keeps its camp prices after the camp has ended;
    a direct bill under an ended camp is refused
  - location codes are unique
  - home visits are hidden where the location has no charge; a quote with a home visit
  - print views contain the required fields
  - only the lead can create or manage accounts; the developer only before first-run setup completes
  - accountant period tally equals the sum of that period's Day Sheets
  - concurrency: two cancellations on one bill; two conversions of one quote; two approvers on one approval
- **Page objects** use role and label locators. Visual baselines are created per screen
  with motion off. `helpers/mock-api.js` is rebuilt.

---

## 12. Frontend framework: React + TypeScript + Vite + Ant Design

### 12.1 Why Ant Design

| Need | antd |
|---|---|
| Item picker, patient / doctor / panel search | `Select` with `showSearch` |
| Items on a quote or bill, live totals | `Form.List` + `Form` validation |
| Catalog entry grid, Day Sheet, approval queue | Editable `Table` (rows via `Form.List`); `Table` with `summary` and row selection |
| Revisit / report-expected date-time | `DatePicker showTime` (dayjs, IST via `lib/ist.ts`) |
| Cancel tests, record collection, approve/reject | `Modal`, `Popconfirm`, `Drawer` |
| Statuses, holds, bill detail, quote → bill | `Tag`, `Descriptions`, `Steps`, `Tabs` |

Mantine was the runner-up (its table is basic). The no-build options were ruled out: Bootstrap
is styling only, Alpine's normal build needs `unsafe-eval`, and htmx needs server-rendered HTML.

### 12.2 Stack

- **React + TypeScript** + **Vite** + **antd** (current major; exact versions pinned at setup).
- **react-router** (single-page app), **dayjs** with `utc` + `timezone` behind `lib/ist.ts`.
- **JsBarcode**, **jsPDF + jspdf-autotable** from npm, bundled. No CDN.
- **antd's default look**, no custom theme. Its default font is the operating system's
  own font stack, so there are no font files to host and Google Fonts goes away.
- **No state library**: React state plus small hooks (`useLookup`, `useSession`).
- **API types** in `types/api.ts`, hand-written for Phase 1.

### 12.3 Layout

```
client/
  index.html
  vite.config.ts          build → client/dist; dev proxy /api → http://localhost:8080
  src/
    main.tsx              ConfigProvider (default theme, en-IN formatting), router
    api.ts  types/api.ts
    lib/ist.ts  lib/money.ts
    auth/                 LoginPage, useSession, RoleRoute
    layout/AppShell.tsx   header (user, role, Change Password, Logout), role-based navigation
    print/                A4 layouts, GT820 quotation layout, Barcode
    features/
      patients/  catalog/  approvals/  doctors/  quotations/  billing/  revisits/  daysheet/
      panels/  masters/  settings/  users/  verify/  analytics/
```

### 12.4 Conventions

- **IST only.** No direct dayjs calls in components; everything goes through `lib/format.ts`.
- **No raw HTML.** React escapes output (BUG-004), and `dangerouslySetInnerHTML` is banned
  via the ESLint `react/no-danger` rule.
- **No double submits** (BUG-010): antd `loading` plus re-entry guards.
- **Money is display-only on the client.** Prices come from the server's pricing function.
- **Accessibility:** labelled `Form.Item`s. The axe specs stay the gate.
- **Motion off** when `prefers-reduced-motion: reduce`.
- **Small components:** one per form or panel; shared bits in `src/components/`.

**Layout rules** (from the review of Step 2's screens; every later screen follows them):
- **Every screen is a `Page`** (`components/Page.tsx`): one `<h1>` title, a one-line
  description, and the screen's main actions top right. Below it come `Section`s, 16px
  apart, each a card whose title is an `<h2>`. No hand-made cards, headings or margins.
- **Tables sit flush in their section** (`<Section flush>`), edge to edge, with the
  first and last columns aligned to the section's 24px padding. Tables are `size="middle"`.
  Short values (codes, dates, money, phone, actions) stay on one line (`NOWRAP`).
- **Row actions are link-style buttons** (`type="link" size="small"`, `danger` for
  destructive ones), confirmed with a `Popconfirm`. A screen's main action is the one
  primary button in its `Page` header.
- **Text must never look like a control.** Status is a `Badge` (dot + text), a category is
  a `Tag`. Who is signed in is plain text in the header's account menu, which holds the
  account actions.
- **Forms:** vertical labels; only optional fields say "(optional)". A field that always
  has a value (a switch, a radio group with a default) is marked `required` so it doesn't.
  Dialogs use `FormModal`.
- **Fields fill the width and adjust to the screen; nothing has a fixed pixel width.**
  On a page, fields sit in an antd `<Row gutter={16}>` with the `COL` presets from
  `components/Page.tsx`: `wide` for names and pickers, `narrow` for phone, email,
  passwords and amounts, `full` for addresses and notes. On wide screens short fields
  share a row; on narrow ones they stack. In dialogs every field is full width. Only the
  login card and the side menu have fixed widths.
- **Spacing comes from antd and these components only:** 24px page padding, 16px between
  sections, antd's own form and card spacing. No ad-hoc margins.
- **Check it visually.** Before a screen is done, screenshot it (and its dialogs) and look
  at alignment and spacing; the axe scan covers contrast and semantics, not looks.

### 12.5 Server, build and deploy

- `server.js` serves `client/dist`, falls back to `index.html` for non-`/api` GETs, and
  redirects the old `*.html` URLs.
- **CSP:** `script-src 'self'` stays (check the built `index.html` once).
  `style-src 'unsafe-inline'` stays (antd's runtime styles). Font and Google entries are dropped.
- **Built on the server PC at every deploy**, so the build reads that install's environment.
  `scripts/deploy.ps1` runs:
  1. `git pull`
  2. `npm ci`
  3. `npx prisma migrate deploy`
  4. `npm run build`
  5. restart the NSSM service
- Vite bakes **only `VITE_`-prefixed** variables into the frontend, and anyone using the app
  can read them. **Never put secrets there.** Secrets stay server-side in `.env`.
- E2E: the Playwright web server command builds first.

---

## 13. Order of work (Phase 1)

| # | Step | Contents | Done when |
|---|---|---|---|
| 0 | ~~Frontend refactor~~ | **Done 2026-10-25** (shared `billing.js` / `analytics.js`, 326/326 e2e). | ✓ |
| 1 | ~~**Foundation (backend)**~~ | **Done 2026-10-26** (106 API specs green; 500/500 over five parallel repeats). Squashed schema (§4), DB rename, roles + lead hand-over, lab settings, locations, patients, doctors, panels + camps, catalog + machines, `Approval`, pricing, billing service. API specs rewritten. **The old plain-JS frontend is retired here.** See §13.1. | ✓ |
| 2 | ~~**Frontend scaffold**~~ | **Done 2026-10-27** (139 specs green: 106 API, 30 UI incl. axe on every screen, 3 session; the parallel part 655/655 over five repeats). Vite + React + TS + antd, login, AppShell, RoleRoute, first-run setup, user accounts (lead), lead hand-over, settings, branches, `server.js`, CSP, `deploy.ps1`. See §13.2. | ✓ |
| 3 | ~~**Catalog + approvals**~~ | **Done 2026-10-27.** Catalog table, entry grid (Excel paste), profiles, machines, approval queue (bulk), My requests, doctors screen. See §13.3. | ✓ |
| 4 | ~~**Billing**~~ | **Done 2026-10-27.** Patients (search, registration, corrections), create bill, bill detail, payments, discounts, cancellations + refunds, holds, revisits, panels / camps / settlement, Day Sheet, A4 prints, verification. | ✓ |
| 5 | **Quotations** | **Built 2026-10-27.** Quote form, validity rules, conversion, re-issue, GT820 print view, barcode. | Specs green ✓; **test print and scan on the real GT820: yours, on site** |
| 6 | ~~**Analytics**~~ | **Done 2026-10-27.** Referral-, payer- and test-wise summaries, period presets, the accountant's tally, PDFs. | ✓ |
| 7 | ~~**Clean-up and docs**~~ | **Done 2026-10-27.** `public/` removed; README, REFERENCE and SETUP_GUIDE rewritten for the LMS; `bugs/` updated. | ✓ |

Revision 1's one-for-one port of the old pages is dropped. The role, category and patient
changes would throw most of it away, and with no live users there's nothing to keep
running in between.

### 13.1 Step 1: how it was built, and where it differs from the plan

**Where things live:**
- **Services:** `src/services/` (`billing`, `approvals`, `patients`, `catalog`, `doctors`,
  `lead`, `priceLists`).
- **Routes:** thin wrappers over the services, using `src/utils/route.js`.
- **Approvals:** each approval kind is defined by the service that owns it
  (`defineApproval`), next to the data it changes.

**Differences from the plan:**
- **One lead, no partial index.** Exactly-one-lead is enforced by locking the single
  `lab_settings` row on every change of lead (`services/lead.js`), not by a partial unique
  index. Prisma can't express partial indexes, and `prisma migrate dev` would keep trying
  to drop one. The tests also found a race: two hand-overs sent at once both passed the
  role check. The lock now re-checks that the sender is still the lead.
- **Look-alike warning.** It fires on the same phone, sex and birth year (±1), instead of
  "a similar name". That's deterministic, and it catches both spelling variants and an age
  given a year later. Family members sharing a phone usually differ in sex or age.
  Confirmed-distinct look-alikes (e.g. twins) are allowed.
- **One pending discount request per bill.** Later changes, including payment-time
  discounts, update the pending request instead of adding a new one. Its `from` stays the
  last approved figure, so a rejection always reverts to an approved amount.
- **Age entry.** A patient entered by age gets 1 January of the estimated birth year as an
  approximate date of birth.

**Additions to §4:**
- `BillEvent`: a bill's history of side effects, such as a rejected doctor being dropped or
  a rejected discount being reverted.
- `BillItem.position` and `QuotationItem.position`: lines print in the order entered.
- `Transaction.kind` (`payment` / `settlement`), for the Day Sheet.
- The `resolved` approval status, with `resolvedBy`/`resolvedAt`.
- `LeadTermReason.first_run`.
- The reserved catalog code `HOMEVISIT`: created on first use, hidden from the catalog, and
  never priced from the catalog.

**Endpoints:**
- `/api/bills/revisits`: pending samples due back.
- `/api/daysheet`, `/api/verify/:code` (bills only until Step 5) and `/api/bills/preview`
  (priced lines, totals, overlap warnings).

**Left for later steps:**
- **Quotations (Step 5):** schema only for now.
- **Analytics (Step 6):** adapted to day-wise (payments − refunds), technician-wise,
  location-wise and patient outstanding/daily/ledger. Category-wise is gone. Referral-,
  payer- and test-wise and the accountant tally come in Step 6.
- **Payment edit/delete:** still API-only (BUG-006).

**Tests:**
- The test DB is dropped and re-migrated on every run.
- The UI specs retired with the old frontend. API specs cover every rule in §4 and §8,
  including concurrency.
- Lead changes run in their own serial Playwright project (`e2e/README.md`).

### 13.2 Step 2: how it was built, and where it differs from the plan

**Where things live:**
- **Code:** `client/` (React 19, TypeScript 6, Vite 8, antd 6, react-router 7, dayjs). Exact
  versions are pinned, all at least two weeks old. TypeScript stays on 6.0 because the
  ESLint tooling doesn't support 7 yet.
- **Single list of screens:** `client/src/pages.tsx` drives both the routes and the side
  menu.
- **Shared parts:** forms in dialogs (`components/FormModal.tsx`), and one hook for data
  plus one for actions with a double-submit guard (`lib/hooks.ts`, BUG-010).
- **Server:** `server.js` serves `client/dist` with a fallback to `index.html` for app
  routes. The old `*.html` URLs redirect into the app, and `public/` is no longer served
  (its removal is still Step 7). The CSP no longer allows Google Fonts.
- **Build and lint:** `npm run build` type-checks and builds. `npm run lint` holds the
  frontend to `react/no-danger` (BUG-004).
- **Deploy:** `scripts/deploy.ps1` pulls, installs, generates the database client, migrates,
  builds and restarts the service.

**Differences from the plan:**
- **Colours.** The look is antd's default, except that antd's own next-darker shade of
  blue, red, green and grey text is used where the defaults miss WCAG AA contrast. The axe
  scans required that (§12.4 keeps axe as the gate), and it stays close to "antd's default
  look" (§11 Q15). It's set in `client/src/main.tsx`.
- **Signing out reloads the page into `/login`.** A client-side navigation raced the route
  guards and could leave a blank page after Back. The reload also drops everything the last
  user saw from memory.
- **Wrong current password returns 400.** Changing your password with a wrong current
  password now returns 400 instead of 401: the session is fine, and the app treats any 401
  as "session ended".
- **Searchable pickers.** The pathologist and branch pickers are searchable, because a long
  list is virtual and otherwise hides names far down.
- **No visual baselines yet.** They wait until the screens settle. The axe scans and UI
  specs are the gate for now.
- **Layout review (2026-10-27).** After your review of the first screens, the frame was
  reworked into the layout rules in §12.4:
  - the antd base stylesheet (no browser margin above the header)
  - an account menu in the header (the role no longer looks like a button)
  - `Page`/`Section` frames, flush tables and link-style row actions
  - a centred login card
  - accurate "(optional)" marks
  - a second review: forms and pickers no longer stop at a fixed width; they fill the
    section through the responsive `COL` grid

### 13.3 Steps 3–7: how they were built, and where they differ from the plan

**Where things live:**
- **Screens:** `client/src/features/` (one folder per area); `pages.tsx` lists
  them all, in menu groups: Reception, Catalog, Approvals, Reports,
  Administration.
- **Quotes and bills share one order form:** `features/billing/order.tsx`, priced
  live through `/api/bills/preview`.
- **Prints:** `client/src/print/`, opened in their own tab, with the print
  dialog opening by itself. Chrome and ZDesigner settings are in
  `SETUP_GUIDE.md` Phase 7.
- **New server code:** `services/quotations.js` and `routes/quotations.js`;
  quotation conversion lives in `services/billing.js` (`quoteLines`), so a quote
  and the bill it becomes share one pricing path.

**Differences from the plan:**
- **Re-issue link.** A re-issued quote points at the one it replaces
  (`Quotation.reissuedFromId`). This is the one schema change since Step 1, in
  its own migration (`20261027000000_quotation_reissue`), so your database
  updates with `prisma migrate deploy` and keeps its data. The old quote stays
  as it was (open, expired) and can no longer be converted. Any expired quote
  can be re-issued, not only one whose prices changed. Its discount carries
  over, capped at the new total.
- **Converting a quote** takes the quote's items, referral, payer, place and
  discount; whatever else the request says about them is ignored. The bill is
  dated today, and the quote is linked to the patient chosen at conversion.
  An expired quote whose camp has ended, or whose test was retired, counts as
  changed: it must be re-issued.
- **Machine steps in the grid** are text, so they paste from Excel: steps in
  order separated by `>`, machines in parallel joined by `+`
  (`Centrifuge > Haematology analyser + Biochemistry analyser`). Draws are
  comma-separated labels (empty means one sample); a profile's tests are
  listed by code. A profile can't be in the same batch as its new tests,
  since its tests must already be approved.
- **A location's type can change** (round 9, after your review). A branch becomes a
  collection centre once it has no machines and no centre sends it samples; it then
  names the branch that processes its samples. A centre can become a branch. The
  location code never changes, and old bills are unaffected (they don't record the type).
- **The front desk** (round 10). A **quick access bar** in the header gives
  technicians New bill, New quotation and Register patient, and pathologists and the lead
  their approval queue with its count; Alt+B, Alt+Q and Alt+P work for every reception
  role. Home is the front desk's day: who is due back for samples, money taken, requests
  waiting. A new bill or quote **opens on a new patient's fields**, the cursor in the name
  (most walk-ins are new); "Returning patient? Search registered patients" switches to the
  search, whose last line, "New patient: …", switches back with what was typed. It starts on
  the patient instead when one is already known (opened from their page, or converting their
  quote). A bill registers a new patient as it's created, and a look-alike is resolved in
  the same place. The side menu
  collapses to its icons and stays so on that PC.
- **My requests:** a screen for every reception user, showing the requests
  they made and the decisions on them (§6.2's "requesters see the status").
  The queue approves or rejects in bulk.
- **Tally details.** Discounts are those on bills raised in the period, split
  by whether a discount approval is still pending. Panel balances are as of
  now, not for the period.
- **Analytics PDFs** print amounts as plain numbers under "(Rs)" headings: the
  PDF library's built-in fonts have no ₹ sign.
- **Conveniences:** each PC remembers the last branch it billed from, so a new
  bill or quote starts there. Patients opens with the latest 50 registered.
  The accountant can read bills, quotations and the catalog.
- **Accessibility.** "Report on hold" is a badge, not a tag (the warning tag
  missed contrast). An empty table's text uses the placeholder grey. Links
  inside a sentence are underlined.

**Not done yet:**
- **The GT820 test print and scan** (Step 5's exit criterion) needs the real
  printer.
- **Visual baselines** still wait until the screens settle after your review.
- **BUG-006** (correcting a payment from the screens) stays parked.

**Tests:** API specs for every new rule (quotations, the tally against day
sheets, referral/payer/test-wise, verify for quotes, a double conversion
race), UI specs for every screen, and an axe scan of every screen and its
main dialog.

---

## 14. Decision log

### Round 1 (on revision 1)

| Q | Answer | Applied in |
|---|---|---|
| 1 Production data | Not live, demo only; full rename OK | §3.1 |
| 2 Patient fields | Age, sex, phone required; more later | §4.4 (doctor made optional in round 2) |
| 3 UI words | Operator → technician; category redone; branch / collection centre / visits | §3.1, §4.3, §4.5 |
| 4–5 TAT | Calendar with machine availability, pathologist-only edits with approval; TAT can wait | §10 |
| 6 Quotation | 48 h; optional; prices reserved while valid | §4.9 |
| 7 Panels / profiles | Cut off in round 1; answered in round 2 (Q6) | §4.6 |
| 8 Single-test cancellation | Needed from day 1 | §4.10 |
| 9 Catalog | No list; ~150 tests | §4.6 |
| 10 Discount | Bill-level only | §4.10 |
| 11 Catalog entry | Technician grid, lead approves, in instalments | §4.2, §6.1 |
| 12 My Bills | Grid of the day's entries, printable | §6.7 |
| 13 Print header | No tax id; lab name, issuing branch address, issuing technician, lab contact; validity terms + barcode | §7.2, §7.3 |
| 14–16 | TypeScript; antd default look; built on the server PC per deploy | §12 |
| Extras 1–5 | Install-time lab settings and lead; one lead; hierarchy; TAT complexity; Zebra/HP printing | §3, §7, §10 |
| Note | Phase 1 = catalog, quotation, billing | §1 |

### Round 2 (on revision 2)

| Q | Answer | Applied in |
|---|---|---|
| 1 Admin role | Remapped to lead pathologist. Pathologists approve reports and propose catalog entries, needing lead approval | §3.1, §3.2, §8 (user accounts: round 3) |
| 2 Lead hand-over | The lead appoints a current pathologist and is warned their account becomes pathologist; a retired lead = pathologist rights | §3.3 |
| 3 Referring doctor | Optional. Added on a separate screen, approved by the lead; bill allowed, report held until approved | §4.5, §4.2, §6.3 |
| 4 Panels | Company camps can get different prices or discounts | §4.5, §4.7 |
| 5 Centres / visits | Centre → processing branch; own location code each; home visit charged per catalog; address optional | §4.3 (charge superseded in round 4: per location) |
| 6 Profiles | Must know which tests a profile covers | §4.6 |
| 7 Quote validity | 48 h from issue. Re-issue uses new prices; an expired quote with unchanged prices stays usable | §4.9 |
| 8 Cancellation | Discussed offline; report held until approved by a pathologist or the lead; refused once the test has started or has results | §4.10, §4.2 |
| 9 Discounts | Any discount allowed (even 100%); every discount approved by a pathologist or the lead, else report held | §4.10, §4.2 |
| 10 Catalog columns | Add the machines each test requires (for TAT) | §4.6 |
| 11 Day Sheet | Cash total by mode needed; lead and accountant can open any | §6.7 |
| 12 Printer | Zebra, continuous fanfold, on the LAN for all PCs | §7.1 (round 4: a GT820 thermal barcode printer) |
| 13 Barcode on bills | Yes; scanners at reception | §7.2, §6.9 |
| 14 Report expected time | Per bill | §4.8 |
| 15 TAT scenarios | Marked in the table | §10.3 |
| 16 Tax | No tax info anywhere | §7.2 |
| 17 Patient number | Only on a few documents | §4.4 (bills and reports: round 6) |
| 18 Pathologists | Full reception access (they cover for technicians on leave) | §3.2, §8 |

### Round 3 (on revision 3, in chat)

| Q | Answer | Applied in |
|---|---|---|
| 9 Printer | A Zebra **dot-matrix** printer (will say if that changes); print **through the browser**, no server-side printing | §7.1, §7.3 (printer type superseded in round 4; browser printing stands) |
| Lead's own catalog changes | Apply directly, without approval | §4.6, §8 |
| 1 User accounts | **Only the lead pathologist** creates accounts (technician, pathologist, accountant). The **accountant role stays**: someone tallies all money daily, weekly and monthly for audit | §3.2, §5, §6.8, §6.10, §8 |


### Round 4 (on revision 3.1, in chat)

| Q | Answer | Applied in |
|---|---|---|
| 2 Lead unreachable | The developer may appoint another pathologist as lead once the lead hasn't signed in for 7 days | §3.3, §4.1, §8 |
| 3 Self-approval | Yes. A pathologist's own approval is enough; the lead isn't needed | §4.2 |
| 4 Rejections | Rare (discussed offline). **Discount:** no report until the full amount is cleared. **Cancellation:** as proposed (held until the lead resolves it). **Doctor:** drop them from the bill | §4.2 |
| 5 Camps | Own record. Custom per-test prices and a % on all tests, both needed, set by the lead for a scheduled period | §4.5, §4.7 |
| 6 Profiles | A test lives standalone and inside profiles; profiles cancel whole; warn on overlap. Sample draws: "does it matter?" (explained; superseded in round 5) | §4.6 |
| 7 Machines | Per branch; by machine type; same sequence = parallel. All confirmed | §4.6 |
| 8 Home visit | Charge depends on the branch/centre: a fixed amount, which the technician can raise | §4.3, §4.7 |
| 9 Printer | **Zebra GT820 thermal barcode printer**, not a dot-matrix | §7.1, §7.3, §10.4 |
| 10 Patient number | Use the existing numbering logic, all-numeric, no letter prefix | §4.4 (superseded in round 5) |


### Round 5 (on revision 3.2, in chat)

| Q | Answer | Applied in |
|---|---|---|
| 1 Standing panel rates | Yes: a TPA or insurer may have its own price catalog | §4.5 (`PriceList` on a panel), §4.7 (camp > panel list > catalog) |
| 2 Profile draws | Don't derive anything for profiles. Draws are test-level: one sample can cover one test, several, or all but one | §4.6, §4.8 (supersedes the round 4 proposal) |
| 3 GT820 media | Max print width 104 mm; continuous; ribbon; 300 mm | §7.1 (300 is the ribbon size, not a page limit: round 6) |
| 4 Patient number | Correction to round 4: not a counter. A unique number **derived from the mandatory fields** | §4.4 (supersedes the round 4 bill-style scheme; details settled in round 6) |


### Round 6 (on revision 3.3, in chat)

| Q | Answer | Applied in |
|---|---|---|
| 1 Patient number | For catching duplicates and faster search. A correction **updates the number**, and historic bills/reports show the updated details. Printed on **bills and reports** | §4.4, §4.8, §6.9, §7.2 |
| 2 300 mm | The ribbon's maximum size, not a quotation page length | §7.1 (page length now follows the content) |


### Round 7 (on revision 3.4, in chat)

| Q | Answer | Applied in |
|---|---|---|
| 1 Duplicate patients | Impossible by definition (same full name, age, sex and phone = same person) and must not be enterable; no merge needed | §4.4 (unique `identityKey`, look-alike warning; merge proposal dropped) |
| 2 Patient corrections | The technician proposes; a pathologist approves; the change applies only after approval | §4.2, §4.4, §5, §6.2, §8 |
| Assumed | A pathologist's or the lead's own correction applies directly, consistent with round 4's self-approval rule. **Say if not.** | §4.2, §4.4, §8 |


### Round 8 (consistency review of revision 3.5, fixes approved in chat)

| Found | Fix | Applied in |
|---|---|---|
| "Approvals don't move money" vs a rejected discount reverting | Approving doesn't move money; a rejected discount does | §2 |
| The hold rule blocked forever on any rejected approval | Explicit hold conditions; a `resolved` status for rejected cancellations | §4.2, §5 |
| Camp-ended check vs a quote's reserved camp prices | The camp period is checked at quote issue and direct billing; conversion within 48 h keeps camp prices | §4.7, §4.9 |
| Day Sheet listed bills, but its totals must reconcile cash | Day Sheet is built from the user's money movements (payments, refunds, settlements) plus the bills they created | §6.7, §11 |
| Driver paper size "set once" vs a per-quotation page length | The driver fixes only the width (104 mm, continuous); the length varies | §7.1 |
| Location codes "own" vs previously shareable | Location codes are unique | §3.1, §4.3 |
| Summaries not updated after later rounds | §1, §3.2, §5, §12.3 and the round 2 log updated | — |
| Quotes couldn't include home visits | Quotes get a collection mode | §4.3, §4.9, §6.4 |
| Home-visit item's catalog price; locations with no charge | Catalog price unused; no charge = no home visits from that location | §4.3 |
| No screen for patient corrections | A Patients screen | §6.11, §13 (Step 4) |
| A camp bill's location unstated | A camp quote or bill uses the camp's branch/centre | §4.5 |

### Round 9 (review of the Phase 1 screens, in chat)

| Found | Decision | Applied in |
|---|---|---|
| A branch couldn't be changed into a collection centre | The lead may convert a branch that has no machines; its samples go to another branch for processing. (Also refused while a centre still sends it samples; a centre can become a branch.) | §13.3, `routes/locations.js` |

### Round 10 (review of the Phase 1 screens, in chat)

| Found | Decision | Applied in |
|---|---|---|
| New bill, New quotation and Register patient took two steps; a new patient on a bill took a dialog | A quick access bar in the header (technicians: the three actions; pathologists, rarely at reception: the approval queue), keyboard shortcuts, a front-desk Home, and new patients entered inline on the bill and quote forms | §13.3, `layout/QuickAccess.tsx`, `features/patients/` |
| A side menu that can't be hidden | Collapsible to its icons, remembered per PC | `layout/AppShell.tsx` |
| Converting a quote meant opening it first | A Convert to bill button in each convertible quote's row (the list says which can convert now) | `routes/quotations.js`, `QuotationsPage.tsx` |
| The 24-hour time pickers were hard for technicians | Every time is 12-hour with AM/PM: the pickers (revisit due time, report expected by, camp period), screens and prints | `lib/format.ts` (`DATE_TIME`, `formatDateTime`) |
| Marking a revisit sample collected took one unconfirmed click | A confirmation first, on the revisit list and on the bill's Record collection | `RevisitsPage.tsx`, `BillDetailPage.tsx` |
| The menu's groups couldn't be folded | Each group (Reception, Catalog, …) folds open and shut, remembered per PC; the icon-only menu stays flat | `layout/AppShell.tsx` |
| Finding every test through the search was slow | A grid of 18 tiles on the bill and quote forms: chosen automatically, lab-wide, as the items billed most in the last 90 days (cancelled lines don't count), shown in code order so a tile only moves when the set changes; a new lab fills the rest from the catalog. No prices on tiles (a panel's or camp's can differ); a tile under a chosen profile says "in LIPID". The search also takes several codes at once ("CBC TSH LFT", Enter) | `GET /api/catalog/popular`, `order.tsx` |
| Creating the bill meant scrolling back to the top | A second Create bill (and Save & print on quotes) at the end of the form, next after the payment for Tab | `NewBillPage.tsx`, `NewQuotationPage.tsx` |

---

## 15. Open questions

None outstanding. Apart from the one assumption flagged in round 7 above, every question
from rounds 1–7 is answered, and round 8's consistency fixes are applied. Phase 1 is
built (§13); the next step is your review of the screens, and the GT820 test print.
