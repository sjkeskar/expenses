// Quotations (pivot.md §4.9): optional, priced like a bill (§4.7), valid for
// 48 hours. Converting one into a bill is createBill's job (services/billing.js),
// so a quote and the bill it becomes share one pricing path.
const { toPaise, fromPaise, parseMoney } = require("../utils/money");
const { generateBillNumber } = require("../utils/billNumber");
const { generateVerificationCode } = require("../utils/verificationCode");
const { getIstDateString, buildBillCounterKey } = require("../utils/istDate");
const { normalisePhone } = require("../utils/patientNumber");
const { HOME_VISIT_CODE, LINE_CATALOG, QUOTE_LINES, resolveContext, priceLines, totalsOf, quoteLines, lockQuotation } = require("./billing");

const VALID_HOURS = 48;

const QUOTE_DETAIL = {
  patient: true,
  location: true,
  createdBy: { select: { id: true, name: true } },
  referringDoctor: true,
  panel: { select: { id: true, name: true, type: true } },
  camp: { select: { id: true, name: true } },
  items: { include: LINE_CATALOG, orderBy: { position: "asc" } },
  bill: { select: { id: true, billNumber: true } },
  reissuedFrom: { select: { id: true, quoteNumber: true } },
  reissuedAs: { select: { id: true, quoteNumber: true } },
};

// "Expired" isn't stored: it's an open quote past its validity.
const presentQuote = (quote, now = new Date()) => ({ ...quote, expired: quote.status === "open" && now > quote.validUntil });

// Who the quote is for: a registered patient, or just a name and phone (a
// patient record is only created when the quote becomes a bill).
async function quotedFor(tx, { patientId, patientName, patientPhone }) {
  if (patientId) {
    const patient = await tx.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw { status: 400, message: "Select a registered patient." };
    return { patientId: patient.id, patientName: patient.name, patientPhone: patient.phone };
  }
  const name = typeof patientName === "string" ? patientName.trim().replace(/\s+/g, " ") : "";
  if (!name) throw { status: 400, message: "Enter the patient's name, or pick a registered patient." };
  const phone = patientPhone ? normalisePhone(patientPhone) : null;
  if (phone !== null && phone.length !== 10) throw { status: 400, message: "Enter a 10-digit phone number." };
  return { patientId: null, patientName: name, patientPhone: phone };
}

// Issues a quote at today's prices and returns its id. Input (POST
// /api/quotations): patientId | patientName + patientPhone?, itemIds,
// referralType, referringDoctorId?, payerType, panelId?, campId?, locationId,
// collectionMode?, homeVisitCharge?, discountAmount?. A camp quote is only
// issued while the camp is running.
async function issueQuote(tx, input, user, reissuedFromId = null) {
  const now = new Date();
  const patient = await quotedFor(tx, input);
  const ctx = await resolveContext(tx, input, now);
  const lines = await priceLines(tx, input.itemIds, ctx, input.homeVisitCharge);
  const discountPaise = parseMoney(input.discountAmount, "discountAmount");
  const totals = totalsOf(lines, discountPaise);
  if (toPaise(totals.netAmount) < 0) {
    throw { status: 400, message: `The discount (${fromPaise(discountPaise)}) can't exceed the total (${totals.originalAmount}).` };
  }

  const quote = await tx.quotation.create({
    data: {
      quoteNumber: await generateBillNumber(tx, `Q${buildBillCounterKey(ctx.location.locationCode, getIstDateString(now))}`),
      verificationCode: generateVerificationCode(),
      ...patient,
      locationId: ctx.location.id,
      collectionMode: ctx.collectionMode,
      createdById: user.id,
      referralType: ctx.referralType,
      referringDoctorId: ctx.doctor?.id ?? null,
      payerType: ctx.payerType,
      panelId: ctx.panel?.id ?? null,
      campId: ctx.camp?.id ?? null,
      ...totals,
      issuedAt: now,
      validUntil: new Date(now.getTime() + VALID_HOURS * 3600_000),
      reissuedFromId,
      items: {
        create: lines.map(({ item, pricePaise }, position) => ({
          position,
          catalogItemId: item.id,
          code: item.code,
          name: item.name,
          kind: item.kind,
          price: fromPaise(pricePaise),
        })),
      },
    },
  });
  return quote.id;
}

// Re-issues an expired quote: a new quote, new number, today's prices and a
// fresh 48 h, for the same patient, items and payer. The old one stays as
// history and can no longer be converted. The discount carries over, capped
// at the new total.
async function reissueQuote(tx, quotationId, user) {
  const old = await lockQuotation(tx, quotationId);
  if (old.status !== "open") throw { status: 409, message: `Quotation ${old.quoteNumber} is ${old.status}.` };
  if (old.reissuedAs) throw { status: 409, message: `Quotation ${old.quoteNumber} was already re-issued as ${old.reissuedAs.quoteNumber}.` };
  if (new Date() <= old.validUntil) throw { status: 409, message: `Quotation ${old.quoteNumber} is still valid.` };

  const homeVisit = old.items.find((i) => i.code === HOME_VISIT_CODE);
  const input = {
    patientId: old.patientId,
    patientName: old.patientName,
    patientPhone: old.patientPhone,
    itemIds: old.items.filter((i) => i !== homeVisit).map((i) => i.catalogItemId),
    referralType: old.referralType,
    referringDoctorId: old.referringDoctorId,
    payerType: old.payerType,
    panelId: old.panelId,
    campId: old.campId,
    locationId: old.locationId,
    collectionMode: old.collectionMode,
    homeVisitCharge: homeVisit?.price,
  };
  const lines = await priceLines(tx, input.itemIds, await resolveContext(tx, input, new Date()), input.homeVisitCharge);
  const total = lines.reduce((sum, l) => sum + l.pricePaise, 0);
  return issueQuote(tx, { ...input, discountAmount: fromPaise(Math.min(total, toPaise(old.discountAmount))) }, user, old.id);
}

async function cancelQuote(tx, quotationId) {
  const quote = await lockQuotation(tx, quotationId);
  if (quote.status !== "open") throw { status: 409, message: `Quotation ${quote.quoteNumber} is ${quote.status}.` };
  await tx.quotation.update({ where: { id: quote.id }, data: { status: "cancelled" } });
}

// Whether the quote can become a bill now, and if not, why (shown on the
// quote screen; createBill re-checks under the lock).
async function conversionCheck(tx, quotationId) {
  const quote = await tx.quotation.findUnique({ where: { id: quotationId }, include: QUOTE_LINES });
  try {
    await quoteLines(tx, quote);
    return { allowed: true };
  } catch (err) {
    if (!err.status) throw err;
    return { allowed: false, reason: err.message, reissue: Boolean(err.details?.reissue) };
  }
}

async function getQuote(tx, quotationId) {
  const quote = await tx.quotation.findUnique({ where: { id: quotationId }, include: QUOTE_DETAIL });
  if (!quote) throw { status: 404, message: "Quotation not found." };
  return { ...presentQuote(quote), conversion: await conversionCheck(tx, quote.id) };
}

module.exports = { presentQuote, issueQuote, reissueQuote, cancelQuote, getQuote, conversionCheck };
