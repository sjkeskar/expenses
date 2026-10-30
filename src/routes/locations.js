const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { parseMoney, fromPaise } = require("../utils/money");
const { route } = require("../utils/route");

const router = express.Router();

const LOCATION_CODE_REGEX = /^\d{2}$/;
const TYPES = ["branch", "collection_centre"];
const WITH_BRANCH = { processingBranch: { select: { id: true, name: true } } };

// Validates the editable fields. A collection centre must name the active
// branch that processes its samples; a branch processes its own. A null
// homeVisitCharge means no home visits from this location (pivot.md §4.3).
async function editableFields(body, type, selfId = null) {
  const name = (body.name || "").trim();
  const address = (body.address || "").trim();
  if (!name || !address) throw { status: 400, message: "Location name and address are required." };

  let processingBranchId = null;
  if (type === "collection_centre") {
    const branch = body.processingBranchId ? await prisma.location.findUnique({ where: { id: body.processingBranchId } }) : null;
    if (!branch || branch.type !== "branch" || !branch.isActive || branch.id === selfId) {
      throw { status: 400, message: "A collection centre needs the active branch that processes its samples." };
    }
    processingBranchId = branch.id;
  }
  const charge = body.homeVisitCharge;
  return {
    name,
    address,
    phone: (body.phone || "").trim() || null,
    processingBranchId,
    homeVisitCharge: charge === undefined || charge === null || charge === "" ? null : fromPaise(parseMoney(charge, "homeVisitCharge")),
  };
}

// GET /api/locations — active branches and collection centres.
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load locations.", async (req, res) => {
  const locations = await prisma.location.findMany({ where: { isActive: true }, include: WITH_BRANCH, orderBy: { name: "asc" } });
  res.json({ locations });
}));

// POST /api/locations — lead. Body: { name, locationCode, type, address,
// phone?, processingBranchId? (centres), homeVisitCharge? }. The 2-digit
// code is unique and fixed once created: it prefixes every bill number.
router.post("/", requireAuth, requireRole(...LEAD), route("Could not add the location.", async (req, res) => {
  const locationCode = (req.body.locationCode || "").trim();
  if (!LOCATION_CODE_REGEX.test(locationCode)) throw { status: 400, message: "Location code must be exactly 2 digits (e.g. 04)." };
  if (!TYPES.includes(req.body.type)) throw { status: 400, message: "type must be branch or collection_centre." };
  const data = { ...(await editableFields(req.body, req.body.type)), locationCode, type: req.body.type };
  if (await prisma.location.findUnique({ where: { locationCode } })) throw { status: 409, message: `Location code ${locationCode} is already in use.` };
  if (await prisma.location.findUnique({ where: { name: data.name } })) throw { status: 409, message: "A location with that name already exists." };

  res.status(201).json({ location: await prisma.location.create({ data, include: WITH_BRANCH }) });
}));

// PATCH /api/locations/:id — lead. The editable fields as in POST, plus
// the type; the code never changes (it starts every bill number raised
// there). A branch becomes a collection centre only once nothing depends
// on it being a branch: no machines there, and no centre sending it
// samples. As a centre it names the branch that processes its samples.
// Bills don't record the type, so old bills are unaffected.
router.patch("/:id", requireAuth, requireRole(...LEAD), route("Could not update the location.", async (req, res) => {
  const current = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: { machines: { where: { isActive: true } }, centres: { where: { isActive: true } } },
  });
  if (!current || !current.isActive) throw { status: 404, message: "Location not found." };
  const type = req.body.type ?? current.type;
  if (!TYPES.includes(type)) throw { status: 400, message: "type must be branch or collection_centre." };
  if (current.type === "branch" && type === "collection_centre") {
    if (current.machines.length) {
      throw { status: 409, message: `${current.name} still has machines (${current.machines.map((m) => m.name).join(", ")}). Remove or move them first.` };
    }
    if (current.centres.length) {
      throw { status: 409, message: `${current.name} still processes samples for ${current.centres.map((c) => c.name).join(", ")}. Send their samples to another branch first.` };
    }
  }
  const data = await editableFields({ ...current, ...req.body }, type, current.id);
  res.json({ location: await prisma.location.update({ where: { id: current.id }, data: { ...data, type }, include: WITH_BRANCH }) });
}));

// DELETE /api/locations/:id — lead. A soft delete: bills keep showing the
// location, it just disappears from the pickers. A branch still processing
// samples for an active collection centre can't be removed.
router.delete("/:id", requireAuth, requireRole(...LEAD), route("Could not remove the location.", async (req, res) => {
  const location = await prisma.location.findUnique({ where: { id: req.params.id }, include: { centres: { where: { isActive: true } } } });
  if (!location || !location.isActive) throw { status: 404, message: "Location not found." };
  if (location.centres.length) {
    throw { status: 409, message: `${location.name} still processes samples for ${location.centres[0].name}.` };
  }
  res.json({ location: await prisma.location.update({ where: { id: location.id }, data: { isActive: false } }) });
}));

module.exports = router;
