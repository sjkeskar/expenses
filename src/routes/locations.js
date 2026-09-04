const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/locations — operator + admin. Active locations only, for the
// typeable location picker on the Create Bill form.
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  res.json({ locations });
});

// POST /api/locations — admin only. Adds a new location to the fixed list.
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name } = req.body;
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    return res.status(400).json({ error: "Location name is required." });
  }

  const existing = await prisma.location.findFirst({
    where: { name: { equals: trimmedName, mode: "insensitive" } },
  });
  if (existing) {
    if (existing.isActive) {
      return res.status(409).json({ error: "A location with that name already exists." });
    }
    // Reviving a previously-deleted location with the same name, rather
    // than creating a duplicate row.
    const revived = await prisma.location.update({
      where: { id: existing.id },
      data: { isActive: true },
      select: { id: true, name: true },
    });
    return res.status(201).json({ location: revived });
  }

  const location = await prisma.location.create({
    data: { name: trimmedName },
    select: { id: true, name: true },
  });
  res.status(201).json({ location });
});

// DELETE /api/locations/:id — admin only.
// This is a soft delete (isActive = false), not a hard delete: bills
// already created at this location keep referencing it correctly for
// historical display, but it disappears from the picker for new bills.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const location = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!location || !location.isActive) {
    return res.status(404).json({ error: "Location not found." });
  }

  const updated = await prisma.location.update({
    where: { id: location.id },
    data: { isActive: false },
    select: { id: true, name: true, isActive: true },
  });
  res.json({ location: updated });
});

module.exports = router;
