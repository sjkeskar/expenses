const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/clients — operator + admin (needed to pick a client when billing).
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  res.json({ clients });
});

// POST /api/clients — operator + admin. Only "name" is stored (confirmed decision).
router.post("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Client name is required." });
  }
  const client = await prisma.client.create({ data: { name: name.trim() } });
  res.status(201).json({ client });
});

module.exports = router;
