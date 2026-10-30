const express = require("express");
const argon2 = require("argon2");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { validatePassword } = require("../utils/passwordPolicy");
const { route, transaction } = require("../utils/route");
const { INACTIVE_DAYS, currentLead, lastActivity, isLeadInactive, appointLead } = require("../services/lead");

const router = express.Router();

// The accounts the lead creates and manages (pivot.md §3.2). Developer
// accounts come only from scripts/create-first-developer.sql; the lead only
// from first-run setup (settings.js) or a change of lead (below).
const MANAGED_ROLES = ["pathologist", "technician", "accountant"];
const PUBLIC = { id: true, name: true, role: true, isDeleted: true, deletedAt: true, lastLoginAt: true, createdAt: true };

async function managedUser(id) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.isDeleted) throw { status: 404, message: "User not found." };
  if (!MANAGED_ROLES.includes(user.role)) {
    throw { status: 400, message: "Only pathologist, technician and accountant accounts are managed here." };
  }
  return user;
}

// GET /api/users — lead: every account.
router.get("/", requireAuth, requireRole(...LEAD), route("Could not load users.", async (req, res) => {
  res.json({ users: await prisma.user.findMany({ select: PUBLIC, orderBy: { createdAt: "asc" } }) });
}));

// GET /api/users/reception — lead: who a bill can be reassigned to.
router.get("/reception", requireAuth, requireRole(...LEAD), route("Could not load users.", async (req, res) => {
  const users = await prisma.user.findMany({
    where: { isDeleted: false, role: { in: RECEPTION } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
}));

// GET /api/users/lead — lead + developer: the current lead, whether the
// developer may re-appoint (7 days without the lead signing in), and the
// pathologists a new lead can be chosen from.
router.get("/lead", requireAuth, requireRole(...LEAD, "developer"), route("Could not load the lead.", async (req, res) => {
  const lead = await currentLead(prisma);
  const pathologists = await prisma.user.findMany({
    where: { role: "pathologist", isDeleted: false },
    select: { id: true, name: true, lastLoginAt: true },
    orderBy: { name: "asc" },
  });
  res.json({
    lead: lead && {
      id: lead.id,
      name: lead.name,
      lastActivity: await lastActivity(prisma, lead),
      inactive: await isLeadInactive(prisma, lead),
    },
    inactiveAfterDays: INACTIVE_DAYS,
    pathologists,
  });
}));

// POST /api/users — lead creates an account. Body: { name, password, role }.
router.post("/", requireAuth, requireRole(...LEAD), route("Could not create user.", async (req, res) => {
  const name = (req.body.name || "").trim();
  const { password, role } = req.body;
  if (!name || !password) throw { status: 400, message: "name and password are required." };
  if (!MANAGED_ROLES.includes(role)) throw { status: 400, message: "role must be pathologist, technician or accountant." };
  const policyError = validatePassword(password);
  if (policyError) throw { status: 400, message: policyError };
  if (await prisma.user.findUnique({ where: { name } })) throw { status: 409, message: "A user with that name already exists." };

  const user = await prisma.user.create({ data: { name, role, passwordHash: await argon2.hash(password) }, select: PUBLIC });
  res.status(201).json({ user });
}));

// PATCH /api/users/:id/password — lead resets an account's password.
// Body: { newPassword }. The user's live sessions keep working; they sign
// in with the new password next time.
router.patch("/:id/password", requireAuth, requireRole(...LEAD), route("Could not reset the password.", async (req, res) => {
  const user = await managedUser(req.params.id);
  const policyError = validatePassword(req.body.newPassword);
  if (policyError) throw { status: 400, message: policyError };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(req.body.newPassword) } });
  res.json({ ok: true });
}));

// DELETE /api/users/:id — lead deactivates an account (soft delete). Its
// sessions stop working on their next request (middleware/auth.js).
router.delete("/:id", requireAuth, requireRole(...LEAD), route("Could not deactivate the user.", async (req, res) => {
  const target = await managedUser(req.params.id);
  const user = await prisma.user.update({
    where: { id: target.id },
    data: { isDeleted: true, deletedAt: new Date(), deletedById: req.session.user.id },
    select: PUBLIC,
  });
  res.json({ user });
}));

// POST /api/users/lead/handover — the lead makes a pathologist the lead and
// becomes a pathologist themselves. Body: { pathologistId }.
router.post("/lead/handover", requireAuth, requireRole(...LEAD), route("Could not hand over.", async (req, res) => {
  const lead = await transaction((tx) => appointLead(tx, req.body.pathologistId, "handover", req.session.user));
  res.json({ lead: { id: lead.id, name: lead.name } });
}));

// POST /api/users/lead/appoint — developer only, once the lead hasn't signed
// in for 7 days. Body: { pathologistId }.
router.post("/lead/appoint", requireAuth, requireRole("developer"), route("Could not appoint the lead.", async (req, res) => {
  const lead = await transaction((tx) => appointLead(tx, req.body.pathologistId, "inactive_lead", req.session.user));
  res.json({ lead: { id: lead.id, name: lead.name } });
}));

module.exports = router;
