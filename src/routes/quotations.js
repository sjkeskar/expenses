const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { route, transaction } = require("../utils/route");
const quotations = require("../services/quotations");

const router = express.Router();

const READERS = [...RECEPTION, "accountant"];

// Runs a change to one quote in a transaction and answers with the quote as
// it now is (or, for a re-issue, the new quote).
const quoteAction = (fallback, change, status = 200) =>
  route(fallback, async (req, res) => {
    const quotation = await transaction(async (tx) => quotations.getQuote(tx, (await change(tx, req)) ?? req.params.id));
    res.status(status).json({ quotation });
  });

// GET /api/quotations?q=&status= — newest first, up to 100. q matches a quote
// number, or the patient's name or phone. status "expired" means open and
// past its validity; "open" means still valid. Each open quote says whether
// it can be converted now (convertible), for the list's Convert button.
router.get("/", requireAuth, requireRole(...READERS), route("Could not load quotations.", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const now = new Date();
  const byStatus = {
    open: { status: "open", validUntil: { gte: now } },
    expired: { status: "open", validUntil: { lt: now } },
    converted: { status: "converted" },
    cancelled: { status: "cancelled" },
  };
  const where = {
    ...byStatus[req.query.status],
    ...(q && {
      OR: [{ quoteNumber: q.toUpperCase() }, { patientPhone: { contains: q } }, { patientName: { contains: q, mode: "insensitive" } }],
    }),
  };
  const list = await prisma.quotation.findMany({
    where,
    include: { location: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, bill: { select: { id: true, billNumber: true } } },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });
  const convertible = await Promise.all(
    list.map(async (quote) => quote.status === "open" && (await quotations.conversionCheck(prisma, quote.id)).allowed)
  );
  res.json({ quotations: list.map((quote, i) => ({ ...quotations.presentQuote(quote, now), convertible: convertible[i] })) });
}));

// GET /api/quotations/:id — the quote, its lines, and whether it can be
// converted now (conversion: { allowed, reason?, reissue? }).
router.get("/:id", requireAuth, requireRole(...READERS), route("Could not load the quotation.", async (req, res) => {
  res.json({ quotation: await transaction((tx) => quotations.getQuote(tx, req.params.id)) });
}));

// POST /api/quotations — see issueQuote in services/quotations.js for the body.
router.post("/", requireAuth, requireRole(...RECEPTION), quoteAction("Could not issue the quotation.", (tx, req) =>
  quotations.issueQuote(tx, req.body, req.session.user), 201
));

// POST /api/quotations/:id/reissue — an expired quote at today's prices.
router.post("/:id/reissue", requireAuth, requireRole(...RECEPTION), quoteAction("Could not re-issue the quotation.", (tx, req) =>
  quotations.reissueQuote(tx, req.params.id, req.session.user), 201
));

// POST /api/quotations/:id/cancel
router.post("/:id/cancel", requireAuth, requireRole(...RECEPTION), quoteAction("Could not cancel the quotation.", (tx, req) =>
  quotations.cancelQuote(tx, req.params.id)
));

// Converting a quote is POST /api/bills with { quotationId, patientId, … }.

module.exports = router;
