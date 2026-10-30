// Billing (pivot.md §4.7–4.10): pricing, bill creation, totals, discounts,
// cancellations with refunds, sample collection and report holds.
//
// Two rules hold everywhere, both from real bugs (BUG-008, BUG-011):
// - every amount is integer paise (src/utils/money.js), never a float;
// - every write that changes a bill's money locks the bill row first, then
//   reads it, so a competing write that committed meanwhile is seen.
const crypto = require("crypto");
const { toPaise, fromPaise, parseMoney } = require("../utils/money");
const { VALID_MODES } = require("../utils/paymentModes");
const { generateBillNumber } = require("../utils/billNumber");
const { generateVerificationCode } = require("../utils/verificationCode");
const {
  getIstDateString,
  isValidDateString,
  buildBillCounterKey,
  combineDateWithCurrentIstTime,
  parseInstant,
  ageOn,
} = require("../utils/istDate");
const { APPROVERS } = require("../middleware/auth");
const { defineApproval, requestApproval, review } = require("./approvals");

// The catalog service item behind every home-visit line. Its catalog price is
// never used: the charge comes from the location (pivot.md §4.3).
const HOME_VISIT_CODE = "HOMEVISIT";

const sumPaise = (rows, field) => rows.reduce((total, row) => total + toPaise(row[field]), 0);

const CODE_NAME = { select: { id: true, code: true, name: true } };

// A line's catalog details for screens and prints: patient instructions,
// and a profile's tests (printed under it).
const LINE_CATALOG = {
  catalogItem: { select: { instructions: true, components: { select: { test: { select: { id: true, code: true, name: true, instructions: true } } } } } },
};

// Everything a bill screen or print needs, in one include.
const BILL_DETAIL = {
  patient: true,
  location: true,
  createdBy: { select: { id: true, name: true } },
  referringDoctor: true,
  panel: { select: { id: true, name: true, type: true } },
  camp: { select: { id: true, name: true } },
  items: {
    include: { ...LINE_CATALOG, collections: { include: { test: CODE_NAME }, orderBy: [{ test: { code: "asc" } }, { sequence: "asc" }] } },
    orderBy: { position: "asc" },
  },
  quotation: { select: { id: true, quoteNumber: true } },
  transactions: { where: { isDeleted: false }, include: { operator: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  refunds: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  cancellations: { include: { createdBy: { select: { id: true, name: true } }, items: { select: { id: true, code: true } } }, orderBy: { createdAt: "asc" } },
  approvals: {
    include: { requestedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } } },
    orderBy: { requestedAt: "asc" },
  },
  reassignments: {
    include: {
      fromTechnician: { select: { id: true, name: true } },
      toTechnician: { select: { id: true, name: true } },
      reassignedBy: { select: { id: true, name: true } },
    },
    orderBy: { reassignedAt: "asc" },
  },
  events: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
};

// What every quote/bill line needs from the catalog: a test's draws, a
// profile's tests with theirs.
const DRAWS = { orderBy: { sequence: "asc" } };
const CATALOG_LINE = { draws: DRAWS, components: { include: { test: { include: { draws: DRAWS } } } } };

async function lockBill(tx, billId) {
  await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${billId} FOR UPDATE`;
  const bill = await tx.bill.findUnique({ where: { id: billId } });
  if (!bill) throw { status: 404, message: "Bill not found." };
  return bill;
}

// Recomputes and stores a bill's totals (pivot.md §4.10):
//   originalAmount = Σ active item prices, netAmount = original − discount,
//   balance = net − (payments − refunds).
// The bill-level discount is the one input; pass discountPaise to change it.
// A result that leaves more collected than the net amount is refused —
// callers that legitimately need that (a cancellation) record a refund first.
async function recomputeTotals(tx, billId, { discountPaise } = {}) {
  const bill = await tx.bill.findUnique({
    where: { id: billId },
    include: { items: { where: { status: "active" } }, transactions: { where: { isDeleted: false } }, refunds: true },
  });
  const original = sumPaise(bill.items, "price");
  const discount = discountPaise ?? toPaise(bill.discountAmount);
  if (discount > original) {
    throw { status: 400, message: `The discount (${fromPaise(discount)}) can't exceed the bill's total (${fromPaise(original)}).` };
  }
  const collected = sumPaise(bill.transactions, "amountCollected") - sumPaise(bill.refunds, "amount");
  const balance = original - discount - collected;
  if (balance < 0) {
    throw { status: 400, message: `That would leave ${fromPaise(-balance)} collected beyond the bill's net amount.` };
  }
  return tx.bill.update({
    where: { id: billId },
    data: {
      originalAmount: fromPaise(original),
      discountAmount: fromPaise(discount),
      netAmount: fromPaise(original - discount),
      balance: fromPaise(balance),
      status: bill.items.length === 0 ? "cancelled" : balance === 0 ? "fully_paid" : "pending",
    },
  });
}

// ---------------------------------------------------------------------------
// Discount approvals
// ---------------------------------------------------------------------------

// Every discount change needs a pathologist's or the lead's approval (their
// own are self-approved). One request per bill at a time: a further change
// while one is pending updates it, keeping its `from` — the last approved
// discount — so a rejection always reverts to an approved figure. When an
// approver makes that further change, the pending request counts as approved.
async function recordDiscountChange(tx, billId, fromP, toP, user) {
  if (fromP === toP) return;
  const pending = await tx.approval.findFirst({ where: { billId, subjectType: "bill_discount", status: "pending" } });
  if (!pending) {
    await requestApproval(
      tx,
      { subjectType: "bill_discount", subjectId: billId, billId, payload: { from: fromPaise(fromP), to: fromPaise(toP) } },
      user
    );
    return;
  }
  await tx.approval.update({ where: { id: pending.id }, data: { payload: { ...pending.payload, to: fromPaise(toP) } } });
  if (APPROVERS.includes(user.role)) await review(tx, pending.id, "approve", "Approved with a further change", user);
}

defineApproval("bill_discount", {
  approvers: APPROVERS,
  // Revert to the last approved discount: the patient owes the full amount
  // again, and the report stays held until that's paid (reportHolds).
  onReject: async (tx, approval, user) => {
    await recomputeTotals(tx, approval.billId, { discountPaise: toPaise(approval.payload.from) });
    await tx.billEvent.create({
      data: { billId: approval.billId, kind: "discount_reverted", detail: approval.payload, createdById: user.id },
    });
  },
});

// A rejected cancellation can't be undone (the refund was given), so it just
// holds the report until the lead marks it resolved (approvals.resolve).
defineApproval("bill_cancellation", { approvers: APPROVERS });

// Why a bill's report is on hold (pivot.md §4.2); empty means it may be
// generated. Phase 1 only shows these; report generation enforces them later.
// Needs the bill loaded with `approvals` and `referringDoctor`.
function reportHolds(bill) {
  const holds = new Set();
  for (const a of bill.approvals) {
    const what = a.subjectType === "bill_discount" ? "Discount" : "Cancellation";
    if (a.status === "pending") holds.add(`${what} awaiting approval`);
    if (a.status === "rejected" && a.subjectType === "bill_discount" && toPaise(bill.balance) > 0) {
      holds.add("Discount rejected: full amount due");
    }
    if (a.status === "rejected" && a.subjectType === "bill_cancellation") holds.add("Cancellation rejected: awaiting the lead");
  }
  if (bill.referringDoctor && bill.referringDoctor.status !== "approved") holds.add("Referring doctor awaiting approval");
  return [...holds];
}

// A bill as the API returns it: its holds, and the patient's age as of the
// bill date (computed from the current DOB, so a correction shows here too).
function presentBill(bill) {
  return { ...bill, holds: reportHolds(bill), patientAge: ageOn(bill.patient.dateOfBirth, bill.createdAt) };
}

async function getBill(tx, billId) {
  const bill = await tx.bill.findUnique({ where: { id: billId }, include: BILL_DETAIL });
  if (!bill) throw { status: 404, message: "Bill not found." };
  return presentBill(bill);
}

// ---------------------------------------------------------------------------
// Pricing (pivot.md §4.7)
// ---------------------------------------------------------------------------

// From a price list: its custom price if the item is listed, otherwise the
// catalog price less its discountPercent. No list = catalog price.
function priceFor(item, priceList) {
  const listed = priceList?.items.find((row) => row.catalogItemId === item.id);
  if (listed) return toPaise(listed.price);
  const percent = priceList?.discountPercent ? Number(priceList.discountPercent) : 0;
  return Math.round((toPaise(item.price) * (100 - percent)) / 100);
}

const WITH_PRICES = { priceList: { include: { items: true } } };

// Validates who referred, who pays, where and how, as of instant `at`, and
// picks the price list: a running camp's beats the panel's standing list.
async function resolveContext(tx, input, at) {
  const { referralType, referringDoctorId, payerType, panelId, campId, collectionMode = "at_location" } = input;
  let { locationId } = input;

  if (!["walk_in", "doctor"].includes(referralType)) throw { status: 400, message: "referralType must be walk_in or doctor." };
  if (referralType === "walk_in" && referringDoctorId) throw { status: 400, message: "A walk-in has no referring doctor." };
  const doctor = referringDoctorId ? await tx.referringDoctor.findUnique({ where: { id: referringDoctorId } }) : null;
  if (referringDoctorId && (!doctor || !doctor.isActive || doctor.status === "rejected")) {
    throw { status: 400, message: "Select a valid referring doctor." };
  }

  if (!["self", "panel"].includes(payerType)) throw { status: 400, message: "payerType must be self or panel." };
  if (payerType === "self" && (panelId || campId)) throw { status: 400, message: "Only a panel bill can name a panel or camp." };
  const panel = payerType === "panel" && panelId ? await tx.panel.findUnique({ where: { id: panelId }, include: WITH_PRICES }) : null;
  if (payerType === "panel" && !panel?.isActive) throw { status: 400, message: "Select a valid panel." };

  const camp = campId ? await tx.camp.findUnique({ where: { id: campId }, include: WITH_PRICES }) : null;
  if (campId) {
    if (!camp?.isActive || camp.panelId !== panel.id) throw { status: 400, message: "Select a valid camp of this panel." };
    if (at < camp.startsAt || at > camp.endsAt) throw { status: 400, message: "This camp isn't running at that time." };
    if (locationId && locationId !== camp.locationId) throw { status: 400, message: "A camp bill uses the camp's location." };
    locationId = camp.locationId;
  }

  const location = locationId ? await tx.location.findUnique({ where: { id: locationId } }) : null;
  if (!location?.isActive) throw { status: 400, message: "Select a valid location." };
  if (!["at_location", "home_visit"].includes(collectionMode)) {
    throw { status: 400, message: "collectionMode must be at_location or home_visit." };
  }
  if (collectionMode === "home_visit" && location.homeVisitCharge === null) {
    throw { status: 400, message: `${location.name} doesn't offer home visits.` };
  }

  return { referralType, payerType, location, doctor, panel, camp, collectionMode, priceList: camp?.priceList ?? panel?.priceList ?? null };
}

// Created on first use. ON CONFLICT DO NOTHING (rather than Prisma's upsert)
// is what makes two first home-visit bills at the same moment both succeed.
async function homeVisitItem(tx) {
  await tx.$executeRaw`
    INSERT INTO "catalog_items" ("id", "code", "name", "kind", "price", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${HOME_VISIT_CODE}, 'Home visit', 'service', 0, now())
    ON CONFLICT ("code") DO NOTHING`;
  return tx.catalogItem.findUnique({ where: { code: HOME_VISIT_CODE }, include: CATALOG_LINE });
}

// Loads and prices the requested catalog items in the order given, plus the
// home-visit line (at least the location's charge; the technician may raise it).
async function priceLines(tx, itemIds, ctx, homeVisitCharge) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw { status: 400, message: "Add at least one test, profile or service." };
  if (new Set(itemIds).size !== itemIds.length) throw { status: 400, message: "Each item can only be added once." };
  const items = await tx.catalogItem.findMany({
    where: { id: { in: itemIds }, status: "active", code: { not: HOME_VISIT_CODE } },
    include: CATALOG_LINE,
  });
  if (items.length !== itemIds.length) throw { status: 400, message: "Some items aren't in the active catalog." };

  const lines = itemIds.map((id) => {
    const item = items.find((i) => i.id === id);
    return { item, pricePaise: priceFor(item, ctx.priceList) };
  });
  if (ctx.collectionMode === "home_visit") {
    const minimum = toPaise(ctx.location.homeVisitCharge);
    const charge = homeVisitCharge === undefined || homeVisitCharge === null ? minimum : parseMoney(homeVisitCharge, "homeVisitCharge");
    if (charge < minimum) {
      throw { status: 400, message: `The home-visit charge at ${ctx.location.name} is at least ${fromPaise(minimum)}.` };
    }
    lines.push({ item: await homeVisitItem(tx), pricePaise: charge });
  }
  return lines;
}

const testsOf = (item) => (item.kind === "profile" ? item.components.map((c) => c.test) : item.kind === "test" ? [item] : []);

// Tests that would be billed twice: a profile plus one of its own tests, or
// two profiles sharing a test. The form warns; billing them is still allowed.
function overlaps(lines) {
  const billedIn = new Map();
  const warnings = [];
  for (const { item } of lines) {
    for (const test of testsOf(item)) {
      if (billedIn.has(test.id)) warnings.push(`${test.code} is billed twice: in ${billedIn.get(test.id)} and ${item.code}.`);
      else billedIn.set(test.id, item.code);
    }
  }
  return warnings;
}

const totalsOf = (lines, discountPaise) => {
  const original = lines.reduce((t, l) => t + l.pricePaise, 0);
  return { originalAmount: fromPaise(original), discountAmount: fromPaise(discountPaise), netAmount: fromPaise(original - discountPaise) };
};

// ---------------------------------------------------------------------------
// Quotations as the source of a bill (pivot.md §4.9)
// ---------------------------------------------------------------------------

const QUOTE_LINES = { items: { include: { catalogItem: { include: CATALOG_LINE } }, orderBy: { position: "asc" } }, reissuedAs: true };

// The referral, payer and place a quote was issued for, as bill input.
const orderOf = (quote) => ({
  referralType: quote.referralType,
  referringDoctorId: quote.referringDoctorId,
  payerType: quote.payerType,
  panelId: quote.panelId,
  campId: quote.campId,
  locationId: quote.locationId,
  collectionMode: quote.collectionMode,
});

// The lines a quote converts into. Within its 48 h: the quoted prices, even
// if the catalog changed or the camp ended since (the context is checked as
// of issue). After that: today's prices, and only if every one still equals
// the quoted price; otherwise it must be re-issued.
async function quoteLines(tx, quote, now = new Date()) {
  if (quote.status !== "open") throw { status: 409, message: `Quotation ${quote.quoteNumber} is ${quote.status}.` };
  if (quote.reissuedAs) throw { status: 409, message: `Quotation ${quote.quoteNumber} was re-issued as ${quote.reissuedAs.quoteNumber}.` };
  const quoted = quote.items.map((qi) => ({ item: qi.catalogItem, pricePaise: toPaise(qi.price) }));
  if (now <= quote.validUntil) return { ctx: await resolveContext(tx, orderOf(quote), quote.issuedAt), lines: quoted };

  const stale = { status: 409, message: `Quotation ${quote.quoteNumber} has expired and its prices have changed: re-issue it.`, details: { reissue: true } };
  let ctx, lines;
  try {
    ctx = await resolveContext(tx, orderOf(quote), now);
    const homeVisit = quoted.find((l) => l.item.code === HOME_VISIT_CODE);
    const itemIds = quoted.filter((l) => l !== homeVisit).map((l) => l.item.id);
    lines = await priceLines(tx, itemIds, ctx, homeVisit && fromPaise(homeVisit.pricePaise));
  } catch (err) {
    if (err.status === 400) throw stale; // e.g. the camp has ended, or a test was retired
    throw err;
  }
  const quotedPrice = new Map(quoted.map((l) => [l.item.id, l.pricePaise]));
  if (lines.some((l) => quotedPrice.get(l.item.id) !== l.pricePaise)) throw stale;
  return { ctx, lines };
}

async function lockQuotation(tx, quotationId) {
  await tx.$queryRaw`SELECT 1 FROM "quotations" WHERE "id" = ${quotationId} FOR UPDATE`;
  const quote = await tx.quotation.findUnique({ where: { id: quotationId }, include: QUOTE_LINES });
  if (!quote) throw { status: 404, message: "Quotation not found." };
  return quote;
}

const presentLines = (lines) =>
  lines.map(({ item, pricePaise }) => ({ catalogItemId: item.id, code: item.code, name: item.name, kind: item.kind, price: fromPaise(pricePaise) }));

// What the bill (or quote) form shows before saving: priced lines, totals,
// overlap warnings. With quotationId, the lines the quote would convert into.
async function previewBill(tx, input) {
  let lines, discountPaise;
  if (input.quotationId) {
    const quote = await tx.quotation.findUnique({ where: { id: input.quotationId }, include: QUOTE_LINES });
    if (!quote) throw { status: 404, message: "Quotation not found." };
    ({ lines } = await quoteLines(tx, quote));
    discountPaise = toPaise(quote.discountAmount);
  } else {
    const at = input.billDate && isValidDateString(input.billDate) ? combineDateWithCurrentIstTime(input.billDate) : new Date();
    lines = await priceLines(tx, input.itemIds, await resolveContext(tx, input, at), input.homeVisitCharge);
    discountPaise = parseMoney(input.discountAmount, "discountAmount");
  }
  return { lines: presentLines(lines), ...totalsOf(lines, discountPaise), warnings: overlaps(lines) };
}

// ---------------------------------------------------------------------------
// Creating a bill
// ---------------------------------------------------------------------------

// pendingDraws: [{ catalogItemId, testId, sequence, dueAt }] — the draws the
// patient comes back for. Every other draw is collected at billing.
function parsePendingDraws(pendingDraws = []) {
  if (!Array.isArray(pendingDraws)) throw { status: 400, message: "pendingDraws must be a list." };
  return pendingDraws.map((p) => {
    const dueAt = parseInstant(p.dueAt, "dueAt");
    if (!dueAt) throw { status: 400, message: "Every sample left for a revisit needs a due date-time." };
    return { catalogItemId: p.catalogItemId, testId: p.testId, sequence: Number(p.sequence), dueAt };
  });
}

// One SampleCollection per draw of each test on the line — for a profile,
// each component test's draws, so part of it can wait for a revisit.
function collectionsFor({ item }, pendingDraws, at, user) {
  return testsOf(item).flatMap((test) =>
    test.draws.map((draw) => {
      const pending = pendingDraws.find((p) => p.catalogItemId === item.id && p.testId === test.id && p.sequence === draw.sequence);
      const base = { testId: test.id, sequence: draw.sequence, label: draw.label };
      return pending
        ? { ...base, status: "pending", dueAt: pending.dueAt }
        : { ...base, status: "collected", collectedAt: at, collectedById: user.id };
    })
  );
}

function parsePayment(payment) {
  if (!payment || !Number(payment.amount)) return null;
  if (!VALID_MODES.includes(payment.mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(", ")}` };
  return { amountPaise: parseMoney(payment.amount, "initialPayment.amount", { positive: true }), mode: payment.mode };
}

// Creates a bill and returns its id. Input (POST /api/bills):
//   patientId, itemIds, referralType, referringDoctorId?, payerType, panelId?,
//   campId?, locationId, collectionMode?, homeVisitAddress?, homeVisitCharge?,
//   pendingDraws?, discountAmount?, expectedReportAt?, billDate?,
//   initialPayment?: { amount, mode }
// billDate (an IST calendar day, default today) sets the bill-number month
// and createdAt, so a backdated bill sorts and buckets under its own date.
//
// With quotationId instead of the items, referral, payer, place and
// discount, the quote is converted (pivot.md §4.9): those come from the
// quote, it's locked and marked converted here, and a second conversion
// fails cleanly. Its discount was only a proposal: the approval starts now.
async function createBill(tx, input, user) {
  const billDate = input.quotationId ? getIstDateString() : input.billDate || getIstDateString();
  if (!isValidDateString(billDate)) throw { status: 400, message: "billDate must be a valid date in YYYY-MM-DD format." };
  const at = combineDateWithCurrentIstTime(billDate);

  const patient = input.patientId ? await tx.patient.findUnique({ where: { id: input.patientId } }) : null;
  if (!patient) throw { status: 400, message: "Select a registered patient." };
  const quote = input.quotationId ? await lockQuotation(tx, input.quotationId) : null;
  let ctx, lines;
  if (quote) {
    ({ ctx, lines } = await quoteLines(tx, quote));
    if (quote.patientId && quote.patientId !== patient.id) throw { status: 400, message: "This quotation is for another patient." };
  } else {
    ctx = await resolveContext(tx, input, at);
    lines = await priceLines(tx, input.itemIds, ctx, input.homeVisitCharge);
  }
  const pendingDraws = parsePendingDraws(input.pendingDraws);
  const discountPaise = quote ? toPaise(quote.discountAmount) : parseMoney(input.discountAmount, "discountAmount");
  const payment = parsePayment(input.initialPayment);

  const items = lines.map((line, position) => ({
    position,
    catalogItemId: line.item.id,
    code: line.item.code,
    name: line.item.name,
    kind: line.item.kind,
    price: fromPaise(line.pricePaise),
    collections: { create: collectionsFor(line, pendingDraws, at, user) },
  }));
  const pendingCount = items.reduce((n, i) => n + i.collections.create.filter((c) => c.status === "pending").length, 0);
  if (pendingCount !== pendingDraws.length) throw { status: 400, message: "Some samples left for a revisit aren't on this bill." };

  const bill = await tx.bill.create({
    data: {
      billNumber: await generateBillNumber(tx, buildBillCounterKey(ctx.location.locationCode, billDate)),
      verificationCode: generateVerificationCode(),
      patientId: patient.id,
      locationId: ctx.location.id,
      createdById: user.id,
      createdAt: at,
      referralType: ctx.referralType,
      referringDoctorId: ctx.doctor?.id ?? null,
      payerType: ctx.payerType,
      panelId: ctx.panel?.id ?? null,
      campId: ctx.camp?.id ?? null,
      collectionMode: ctx.collectionMode,
      homeVisitAddress: ctx.collectionMode === "home_visit" ? input.homeVisitAddress?.trim() || null : null,
      expectedReportAt: parseInstant(input.expectedReportAt, "expectedReportAt"),
      quotationId: quote?.id ?? null,
      originalAmount: "0",
      netAmount: "0",
      balance: "0",
      items: { create: items },
    },
  });

  if (payment) {
    await tx.transaction.create({
      data: { billId: bill.id, amountCollected: fromPaise(payment.amountPaise), mode: payment.mode, operatorId: user.id, createdAt: at },
    });
  }
  await recomputeTotals(tx, bill.id, { discountPaise });
  await recordDiscountChange(tx, bill.id, 0, discountPaise, user);
  if (quote) await tx.quotation.update({ where: { id: quote.id }, data: { status: "converted", patientId: patient.id } });
  return bill.id;
}

// ---------------------------------------------------------------------------
// Changes after billing
// ---------------------------------------------------------------------------

async function changeDiscount(tx, billId, discountAmount, user) {
  const bill = await lockBill(tx, billId);
  if (bill.status === "cancelled") throw { status: 400, message: "This bill is cancelled." };
  const toP = parseMoney(discountAmount, "discountAmount", { required: true });
  await recomputeTotals(tx, billId, { discountPaise: toP });
  await recordDiscountChange(tx, billId, toPaise(bill.discountAmount), toP, user);
}

// Cancels one or more lines (a profile only ever whole, since it's one line),
// in one locked transaction (pivot.md §4.10). Refused once any of them has
// started processing. The discount defaults to min(current, new subtotal);
// if more was collected than the new net amount, the difference is refunded.
async function cancelItems(tx, billId, { itemIds, reason, discountAmount, refundMode }, user) {
  const bill = await lockBill(tx, billId);
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw { status: 400, message: "Choose the items to cancel." };
  if (!reason || !reason.trim()) throw { status: 400, message: "A cancellation needs a reason." };

  const active = await tx.billItem.findMany({ where: { billId, status: "active" } });
  const chosen = active.filter((i) => itemIds.includes(i.id));
  if (chosen.length !== new Set(itemIds).size) throw { status: 400, message: "Some of those items aren't active on this bill." };
  const started = chosen.find((i) => i.processingStatus !== "not_started");
  if (started) throw { status: 409, message: `${started.code} has already started processing and can't be cancelled.` };

  const remaining = sumPaise(active.filter((i) => !itemIds.includes(i.id)), "price");
  const fromP = toPaise(bill.discountAmount);
  const toP = discountAmount === undefined || discountAmount === null ? Math.min(fromP, remaining) : parseMoney(discountAmount, "discountAmount");
  const payments = await tx.transaction.findMany({ where: { billId, isDeleted: false } });
  const refunds = await tx.refund.findMany({ where: { billId } });
  const refundPaise = Math.max(0, sumPaise(payments, "amountCollected") - sumPaise(refunds, "amount") - (remaining - toP));
  if (refundPaise > 0 && !VALID_MODES.includes(refundMode)) {
    throw { status: 400, message: `${fromPaise(refundPaise)} must be refunded: choose the refund mode.` };
  }

  const cancellation = await tx.cancellation.create({
    data: { billId, reason: reason.trim(), createdById: user.id, items: { connect: chosen.map((i) => ({ id: i.id })) } },
  });
  await tx.billItem.updateMany({ where: { id: { in: itemIds } }, data: { status: "cancelled" } });
  if (refundPaise > 0) {
    await tx.refund.create({
      data: { billId, cancellationId: cancellation.id, amount: fromPaise(refundPaise), mode: refundMode, createdById: user.id },
    });
  }
  await recomputeTotals(tx, billId, { discountPaise: toP });
  await recordDiscountChange(tx, billId, fromP, toP, user);
  await requestApproval(
    tx,
    {
      subjectType: "bill_cancellation",
      subjectId: cancellation.id,
      billId,
      payload: { items: chosen.map((i) => i.code), refund: fromPaise(refundPaise) },
    },
    user
  );
  return cancellation;
}

// Marks pending draws collected — the patient came back (or a further sample
// of a multi-draw test was taken).
async function collectSamples(tx, billId, { collectionIds, collectedAt }, user) {
  await lockBill(tx, billId);
  if (!Array.isArray(collectionIds) || collectionIds.length === 0) throw { status: 400, message: "Choose the samples collected." };
  const rows = await tx.sampleCollection.findMany({
    where: { id: { in: collectionIds }, billItem: { billId, status: "active" } },
  });
  if (rows.length !== new Set(collectionIds).size) throw { status: 400, message: "Some of those samples aren't pending on this bill." };
  if (rows.some((r) => r.status === "collected")) throw { status: 409, message: "Some of those samples are already collected." };
  await tx.sampleCollection.updateMany({
    where: { id: { in: collectionIds } },
    data: { status: "collected", collectedAt: parseInstant(collectedAt, "collectedAt") ?? new Date(), collectedById: user.id },
  });
}

module.exports = {
  HOME_VISIT_CODE,
  BILL_DETAIL,
  CATALOG_LINE,
  LINE_CATALOG,
  QUOTE_LINES,
  lockBill,
  recomputeTotals,
  recordDiscountChange,
  reportHolds,
  presentBill,
  getBill,
  priceFor,
  resolveContext,
  priceLines,
  overlaps,
  totalsOf,
  presentLines,
  quoteLines,
  lockQuotation,
  previewBill,
  createBill,
  changeDiscount,
  cancelItems,
  collectSamples,
};
