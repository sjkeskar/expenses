const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { parseInstant } = require("../utils/istDate");
const { route, transaction } = require("../utils/route");
const { parsePriceList, writePriceList } = require("../services/priceLists");

const router = express.Router();

// A camp is a company-led event with special rates for its scheduled period
// only (pivot.md §4.5); its quotes and bills always use the camp's location.
const INCLUDE = {
  panel: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  priceList: { include: { items: true } },
};

async function campFields(body) {
  const name = (body.name || "").trim();
  if (!name) throw { status: 400, message: "Camp name is required." };
  const panel = body.panelId ? await prisma.panel.findUnique({ where: { id: body.panelId } }) : null;
  if (!panel?.isActive) throw { status: 400, message: "Select the panel (company) running the camp." };
  const location = body.locationId ? await prisma.location.findUnique({ where: { id: body.locationId } }) : null;
  if (!location?.isActive) throw { status: 400, message: "Select the location conducting the camp." };
  const startsAt = parseInstant(body.startsAt, "startsAt");
  const endsAt = parseInstant(body.endsAt, "endsAt");
  if (!startsAt || !endsAt || endsAt <= startsAt) throw { status: 400, message: "A camp needs a start and an end after it." };
  return { name, venue: (body.venue || "").trim() || null, panelId: panel.id, locationId: location.id, startsAt, endsAt };
}

const present = (camp) => ({ ...camp, running: camp.startsAt <= new Date() && new Date() <= camp.endsAt });

// GET /api/camps — active camps, each flagged running or not.
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load camps.", async (req, res) => {
  const camps = await prisma.camp.findMany({ where: { isActive: true }, include: INCLUDE, orderBy: { startsAt: "desc" } });
  res.json({ camps: camps.map(present) });
}));

// POST /api/camps — lead. Body: { panelId, name, venue?, locationId,
// startsAt, endsAt, discountPercent?, items?: [{ catalogItemId, price }] }.
router.post("/", requireAuth, requireRole(...LEAD), route("Could not add the camp.", async (req, res) => {
  const data = await campFields(req.body);
  const camp = await transaction(async (tx) => {
    // A camp always has a price list, even an empty one (catalog prices).
    const parsed = (await parsePriceList(tx, req.body)) ?? { discountPercent: null, rows: [] };
    const priceListId = await writePriceList(tx, null, parsed);
    return tx.camp.create({ data: { ...data, priceListId, createdById: req.session.user.id }, include: INCLUDE });
  });
  res.status(201).json({ camp: present(camp) });
}));

// PATCH /api/camps/:id — lead. Same body as POST; the price list is replaced.
router.patch("/:id", requireAuth, requireRole(...LEAD), route("Could not update the camp.", async (req, res) => {
  const current = await prisma.camp.findUnique({ where: { id: req.params.id }, include: INCLUDE });
  if (!current || !current.isActive) throw { status: 404, message: "Camp not found." };
  const data = await campFields({ ...current, ...req.body, startsAt: req.body.startsAt ?? current.startsAt.toISOString(), endsAt: req.body.endsAt ?? current.endsAt.toISOString() });
  const camp = await transaction(async (tx) => {
    const parsed = (await parsePriceList(tx, { ...current.priceList, ...req.body })) ?? { discountPercent: null, rows: [] };
    await writePriceList(tx, current.priceListId, parsed);
    return tx.camp.update({ where: { id: current.id }, data, include: INCLUDE });
  });
  res.json({ camp: present(camp) });
}));

// DELETE /api/camps/:id — lead. Soft delete; bills keep their camp prices.
router.delete("/:id", requireAuth, requireRole(...LEAD), route("Could not remove the camp.", async (req, res) => {
  const camp = await prisma.camp.findUnique({ where: { id: req.params.id } });
  if (!camp || !camp.isActive) throw { status: 404, message: "Camp not found." };
  res.json({ camp: await prisma.camp.update({ where: { id: camp.id }, data: { isActive: false } }) });
}));

module.exports = router;
