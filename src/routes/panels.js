const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");
const { toPaise, fromPaise } = require("../utils/money");
const { route, transaction } = require("../utils/route");
const { recomputeTotals } = require("../services/billing");
const { parsePriceList, writePriceList } = require("../services/priceLists");

const router = express.Router();

const TYPES = ["corporate", "tpa", "insurer"];
const WITH_PRICES = { priceList: { include: { items: true } } };

function panelFields(body) {
  const name = (body.name || "").trim();
  if (!name) throw { status: 400, message: "Panel name is required." };
  if (!TYPES.includes(body.type)) throw { status: 400, message: "type must be corporate, tpa or insurer." };
  return { name, type: body.type, contact: (body.contact || "").trim() || null };
}

async function activePanel(id) {
  const panel = await prisma.panel.findUnique({ where: { id }, include: WITH_PRICES });
  if (!panel || !panel.isActive) throw { status: 404, message: "Panel not found." };
  return panel;
}

// GET /api/panels — active panels with their standing price lists.
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load panels.", async (req, res) => {
  res.json({ panels: await prisma.panel.findMany({ where: { isActive: true }, include: WITH_PRICES, orderBy: { name: "asc" } }) });
}));

// POST /api/panels — lead. Body: { name, type, contact? }.
router.post("/", requireAuth, requireRole(...LEAD), route("Could not add the panel.", async (req, res) => {
  res.status(201).json({ panel: await prisma.panel.create({ data: panelFields(req.body), include: WITH_PRICES }) });
}));

// PATCH /api/panels/:id — lead. Body: { name, type, contact? }.
router.patch("/:id", requireAuth, requireRole(...LEAD), route("Could not update the panel.", async (req, res) => {
  const panel = await activePanel(req.params.id);
  const data = panelFields({ ...panel, ...req.body });
  res.json({ panel: await prisma.panel.update({ where: { id: panel.id }, data, include: WITH_PRICES }) });
}));

// PUT /api/panels/:id/price-list — lead: replaces the panel's standing rates
// (e.g. an insurer's own catalog). Body: { discountPercent?, items? }; both
// empty removes the list, so the panel is billed at catalog price.
router.put("/:id/price-list", requireAuth, requireRole(...LEAD), route("Could not save the price list.", async (req, res) => {
  const panel = await activePanel(req.params.id);
  const updated = await transaction(async (tx) => {
    const priceListId = await writePriceList(tx, panel.priceListId, await parsePriceList(tx, req.body));
    const saved = await tx.panel.update({ where: { id: panel.id }, data: { priceListId }, include: WITH_PRICES });
    if (!priceListId && panel.priceListId) await tx.priceList.delete({ where: { id: panel.priceListId } });
    return saved;
  });
  res.json({ panel: updated });
}));

// DELETE /api/panels/:id — lead. Soft delete; its bills keep showing it.
router.delete("/:id", requireAuth, requireRole(...LEAD), route("Could not remove the panel.", async (req, res) => {
  const panel = await activePanel(req.params.id);
  res.json({ panel: await prisma.panel.update({ where: { id: panel.id }, data: { isActive: false } }) });
}));

// GET /api/panels/:id/outstanding — the panel's pending bills, for a person
// to choose which to settle (some may be disputed and must be skipped).
router.get("/:id/outstanding", requireAuth, requireRole(...RECEPTION), route("Could not load outstanding bills.", async (req, res) => {
  const panel = await prisma.panel.findUnique({ where: { id: req.params.id } });
  if (!panel) throw { status: 404, message: "Panel not found." };
  const pendingBills = await prisma.bill.findMany({
    where: { panelId: panel.id, payerType: "panel", status: "pending" },
    select: { id: true, billNumber: true, balance: true, createdAt: true, patient: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const outstandingPaise = pendingBills.reduce((sum, b) => sum + toPaise(b.balance), 0);
  res.json({
    panel: { id: panel.id, name: panel.name },
    totalOutstanding: Number(fromPaise(outstandingPaise)),
    pendingBillCount: pendingBills.length,
    pendingBills,
  });
}));

// POST /api/panels/:id/settle — closes a hand-picked set of the panel's
// pending bills, each in full. Body: { billIds, mode }. All-or-nothing: if
// any chosen bill isn't this panel's or isn't pending, nothing is settled.
router.post("/:id/settle", requireAuth, requireRole(...RECEPTION), route("Could not process settlement.", async (req, res) => {
  const { billIds, mode } = req.body;
  if (!Array.isArray(billIds) || billIds.length === 0) throw { status: 400, message: "billIds must be a non-empty array." };
  if (!VALID_MODES.includes(mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(", ")}` };
  // A repeated id is a client bug worth surfacing, not something to de-duplicate (BUG-005).
  if (new Set(billIds).size !== billIds.length) throw { status: 400, message: "Each bill can only be selected once." };

  const result = await transaction(async (tx) => {
    const panel = await tx.panel.findUnique({ where: { id: req.params.id } });
    if (!panel) throw { status: 404, message: "Panel not found." };

    // Lock every chosen bill before reading any, one at a time in sorted
    // order: a deterministic order is what stops two overlapping
    // settlements deadlocking each other.
    for (const id of [...billIds].sort()) {
      await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${id} FOR UPDATE`;
    }
    const bills = await tx.bill.findMany({ where: { id: { in: billIds } } });
    if (bills.length !== billIds.length) throw { status: 404, message: "One or more selected bills could not be found." };
    for (const bill of bills) {
      if (bill.panelId !== panel.id) throw { status: 400, message: `Bill ${bill.billNumber} does not belong to this panel.` };
      if (bill.status !== "pending") throw { status: 400, message: `Bill ${bill.billNumber} is not pending.` };
    }

    const breakdown = [];
    for (const bill of bills) {
      await tx.transaction.create({
        data: { billId: bill.id, kind: "settlement", amountCollected: bill.balance, mode, operatorId: req.session.user.id },
      });
      await recomputeTotals(tx, bill.id);
      breakdown.push({ billId: bill.id, billNumber: bill.billNumber, amountApplied: Number(bill.balance) });
    }
    const totalPaise = bills.reduce((sum, b) => sum + toPaise(b.balance), 0);
    return { panel: { id: panel.id, name: panel.name }, totalSettled: Number(fromPaise(totalPaise)), breakdown };
  });
  res.status(201).json(result);
}));

module.exports = router;
