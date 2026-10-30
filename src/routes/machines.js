const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { route } = require("../utils/route");

const router = express.Router();

// Machine types are what a test requires (any unit of the type at the
// processing branch can run it); machines are the physical units per branch.
// Availability and downtime are a later phase (pivot.md §10).

// GET /api/machines/types
router.get("/types", requireAuth, requireRole(...RECEPTION), route("Could not load machine types.", async (req, res) => {
  res.json({ types: await prisma.machineType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) });
}));

// GET /api/machines
router.get("/", requireAuth, requireRole(...RECEPTION), route("Could not load machines.", async (req, res) => {
  const machines = await prisma.machine.findMany({
    where: { isActive: true },
    include: { machineType: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ machines });
}));

// POST /api/machines/types — lead. Body: { name }.
router.post("/types", requireAuth, requireRole(...LEAD), route("Could not add the machine type.", async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) throw { status: 400, message: "Machine type name is required." };
  res.status(201).json({ type: await prisma.machineType.create({ data: { name } }) });
}));

// POST /api/machines — lead. Body: { name, machineTypeId, branchId }.
router.post("/", requireAuth, requireRole(...LEAD), route("Could not add the machine.", async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) throw { status: 400, message: "Machine name is required." };
  const type = req.body.machineTypeId ? await prisma.machineType.findUnique({ where: { id: req.body.machineTypeId } }) : null;
  if (!type?.isActive) throw { status: 400, message: "Select a machine type." };
  const branch = req.body.branchId ? await prisma.location.findUnique({ where: { id: req.body.branchId } }) : null;
  if (!branch?.isActive || branch.type !== "branch") throw { status: 400, message: "Machines belong to an active processing branch." };
  res.status(201).json({ machine: await prisma.machine.create({ data: { name, machineTypeId: type.id, branchId: branch.id } }) });
}));

// DELETE /api/machines/types/:id and /api/machines/:id — lead. Soft deletes.
router.delete("/types/:id", requireAuth, requireRole(...LEAD), route("Could not remove the machine type.", async (req, res) => {
  res.json({ type: await prisma.machineType.update({ where: { id: req.params.id }, data: { isActive: false } }) });
}));

router.delete("/:id", requireAuth, requireRole(...LEAD), route("Could not remove the machine.", async (req, res) => {
  res.json({ machine: await prisma.machine.update({ where: { id: req.params.id }, data: { isActive: false } }) });
}));

module.exports = router;
