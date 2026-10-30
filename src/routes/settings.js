const express = require("express");
const argon2 = require("argon2");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD } = require("../middleware/auth");
const { validatePassword } = require("../utils/passwordPolicy");
const { route, transaction } = require("../utils/route");

const router = express.Router();

// Lab name and contact details (pivot.md §3.4): they head every print.
function parseSettings(body) {
  const value = (field) => (typeof body[field] === "string" ? body[field].trim() : "");
  const settings = { labName: value("labName"), phone: value("phone"), email: value("email") || null, address: value("address") };
  if (!settings.labName || !settings.phone || !settings.address) {
    throw { status: 400, message: "Lab name, phone and address are required." };
  }
  return settings;
}

// GET /api/settings — any signed-in user. settings is null until first-run setup.
router.get("/", requireAuth, route("Could not load settings.", async (req, res) => {
  res.json({ settings: await prisma.labSettings.findUnique({ where: { id: 1 } }) });
}));

// PATCH /api/settings — lead only. Body: { labName, phone, email?, address }.
router.patch("/", requireAuth, requireRole(...LEAD), route("Could not save settings.", async (req, res) => {
  if (!(await prisma.labSettings.findUnique({ where: { id: 1 } }))) throw { status: 409, message: "The lab hasn't been set up yet." };
  res.json({ settings: await prisma.labSettings.update({ where: { id: 1 }, data: parseSettings(req.body) }) });
}));

// POST /api/settings/setup — developer, once: the lab's settings plus the
// first lead pathologist's account, in one transaction. A second setup is
// impossible: lab_settings is a single row (primary key 1).
// Body: { labName, phone, email?, address, lead: { name, password } }.
router.post("/setup", requireAuth, requireRole("developer"), route("Could not complete setup.", async (req, res) => {
  const settings = parseSettings(req.body);
  const name = (req.body.lead?.name || "").trim();
  const password = req.body.lead?.password;
  if (!name || !password) throw { status: 400, message: "The lead pathologist's name and password are required." };
  const policyError = validatePassword(password);
  if (policyError) throw { status: 400, message: policyError };
  const passwordHash = await argon2.hash(password);

  const result = await transaction(async (tx) => {
    if (await tx.labSettings.findUnique({ where: { id: 1 } })) throw { status: 409, message: "The lab is already set up." };
    if (await tx.user.findUnique({ where: { name } })) throw { status: 409, message: "A user with that name already exists." };
    const saved = await tx.labSettings.create({ data: { id: 1, ...settings } });
    const lead = await tx.user.create({ data: { name, passwordHash, role: "lead_pathologist" } });
    await tx.leadTerm.create({ data: { userId: lead.id, reason: "first_run", appointedById: req.session.user.id } });
    return { settings: saved, lead: { id: lead.id, name: lead.name } };
  });
  res.status(201).json(result);
}));

module.exports = router;
