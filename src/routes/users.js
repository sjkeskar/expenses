const express = require("express");
const argon2 = require("argon2");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validatePassword } = require("../utils/passwordPolicy");

const router = express.Router();

// GET /api/users/operators — admin + developer. Minimal list (id, name only)
// so an admin can pick who to promote, without exposing the full user
// management data that GET /api/users below returns.
router.get(
  "/operators",
  requireAuth,
  requireRole("admin", "developer"),
  async (req, res) => {
    const operators = await prisma.user.findMany({
      where: { role: "operator", isDeleted: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    res.json({ operators });
  }
);

// GET /api/users — developer only (needed to manage the account list).
router.get("/", requireAuth, requireRole("developer"), async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      role: true,
      isDeleted: true,
      deletedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

// POST /api/users — developer only. Creates operator, admin, or developer accounts.
router.post("/", requireAuth, requireRole("developer"), async (req, res) => {
  const { name, password, role } = req.body;

  if (!name || !password || !role) {
    return res.status(400).json({ error: "name, password, and role are required." });
  }
  if (!["operator", "admin", "developer"].includes(role)) {
    return res.status(400).json({ error: "role must be operator, admin, or developer." });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const existing = await prisma.user.findUnique({ where: { name } });
  if (existing) {
    return res.status(409).json({ error: "A user with that name already exists." });
  }

  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: { name, passwordHash, role },
    select: { id: true, name: true, role: true, createdAt: true },
  });

  res.status(201).json({ user });
});

// PATCH /api/users/:id/promote — operator -> admin.
// Confirmed: BOTH admin and developer may do this (one-way action for admin).
router.patch(
  "/:id/promote",
  requireAuth,
  requireRole("admin", "developer"),
  async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.isDeleted) {
      return res.status(404).json({ error: "User not found." });
    }
    if (target.role !== "operator") {
      return res.status(400).json({ error: "Only an operator can be promoted to admin." });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: "admin" },
      select: { id: true, name: true, role: true },
    });
    res.json({ user: updated });
  }
);

// PATCH /api/users/:id/demote — admin -> operator. Developer only.
router.patch(
  "/:id/demote",
  requireAuth,
  requireRole("developer"),
  async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.isDeleted) {
      return res.status(404).json({ error: "User not found." });
    }
    if (target.role !== "admin") {
      return res.status(400).json({ error: "Only an admin can be demoted to operator." });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: "operator" },
      select: { id: true, name: true, role: true },
    });
    res.json({ user: updated });
  }
);

// DELETE /api/users/:id — soft delete (deactivate). Developer only.
router.delete("/:id", requireAuth, requireRole("developer"), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target || target.isDeleted) {
    return res.status(404).json({ error: "User not found." });
  }
  if (target.id === req.session.user.id) {
    return res.status(400).json({ error: "You cannot deactivate your own account." });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedById: req.session.user.id,
    },
    select: { id: true, name: true, isDeleted: true, deletedAt: true },
  });
  res.json({ user: updated });
});

module.exports = router;
