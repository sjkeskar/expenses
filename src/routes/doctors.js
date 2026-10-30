const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { route, transaction } = require("../utils/route");
const { addDoctor } = require("../services/doctors");

const router = express.Router();

// GET /api/doctors — active doctors that can be named on a bill: approved
// ones and those still awaiting the lead's approval (rejected ones never).
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load doctors.", async (req, res) => {
  const doctors = await prisma.referringDoctor.findMany({
    where: { isActive: true, status: { in: ["approved", "pending"] } },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ doctors });
}));

// POST /api/doctors — add a doctor (pending until the lead approves; the
// lead's own are approved at once). Body: { name, phone?, clinic? }.
router.post("/", requireAuth, requireRole(...RECEPTION), route("Could not add the doctor.", async (req, res) => {
  const doctor = await transaction((tx) => addDoctor(tx, req.body, req.session.user));
  res.status(201).json({ doctor });
}));

module.exports = router;
