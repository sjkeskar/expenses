const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { route } = require("../utils/route");
const { presentQuote } = require("../services/quotations");

const router = express.Router();

const INCLUDE = { patient: true, location: { select: { id: true, name: true } } };

// GET /api/verify/:code — the quote or bill a scanned barcode belongs to
// (pivot.md §6.9), so a forged or altered printout can't pass. If the
// patient's details were corrected after the document was issued, it says
// when, so a genuine older printout isn't mistaken for a forgery.
router.get("/:code", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not verify the code.", async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const [bill, quote] = await Promise.all([
    prisma.bill.findUnique({ where: { verificationCode: code }, include: INCLUDE }),
    prisma.quotation.findUnique({ where: { verificationCode: code }, include: INCLUDE }),
  ]);
  if (!bill && !quote) throw { status: 404, message: "No document matches this code. It wasn't issued by this lab." };

  const issuedAt = bill ? bill.createdAt : quote.issuedAt;
  const patient = bill ? bill.patient : quote.patient;
  const correction = patient
    ? await prisma.patientChange.findFirst({ where: { patientId: patient.id, changedAt: { gt: issuedAt } }, orderBy: { changedAt: "desc" } })
    : null;
  const common = {
    issuedAt,
    location: (bill ?? quote).location,
    patient: patient ? { id: patient.id, name: patient.name, patientNumber: patient.patientNumber } : { name: quote.patientName },
    netAmount: (bill ?? quote).netAmount,
    patientCorrectedAt: correction?.changedAt ?? null,
  };
  res.json({
    document: bill
      ? { type: "bill", id: bill.id, number: bill.billNumber, ...common, balance: bill.balance, status: bill.status }
      : { type: "quotation", id: quote.id, number: quote.quoteNumber, ...common, validUntil: quote.validUntil, status: presentQuote(quote).expired ? "expired" : quote.status },
  });
}));

module.exports = router;
