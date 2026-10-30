const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { ageOn } = require("../utils/istDate");
const { route, transaction } = require("../utils/route");
const { registerPatient, proposeCorrection } = require("../services/patients");

const router = express.Router();

const READERS = [...RECEPTION, "accountant"];
const withAge = (patient) => ({ ...patient, age: ageOn(patient.dateOfBirth) });

// GET /api/patients?q= — search by patient number (old numbers too), phone
// digits, or name. Up to 50 matches; no q gives the latest registered.
router.get("/", requireAuth, requireRole(...READERS), route("Could not search patients.", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    const latest = await prisma.patient.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return res.json({ patients: latest.map(withAge) });
  }
  const where = /^\d{13}$/.test(q)
    ? { OR: [{ patientNumber: q }, { aliases: { some: { number: q } } }] }
    : /^\d{4,}$/.test(q)
      ? { phone: { contains: q } }
      : { name: { contains: q, mode: "insensitive" } };
  const patients = await prisma.patient.findMany({ where, orderBy: { name: "asc" }, take: 50 });
  res.json({ patients: patients.map(withAge) });
}));

// GET /api/patients/:id — the patient with their bills, quotations, old
// numbers, applied corrections and any correction awaiting approval.
router.get("/:id", requireAuth, requireRole(...READERS), route("Could not load the patient.", async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: {
      aliases: { orderBy: { retiredAt: "asc" } },
      changes: { orderBy: { changedAt: "asc" } },
      bills: { select: { id: true, billNumber: true, createdAt: true, netAmount: true, balance: true, status: true }, orderBy: { createdAt: "desc" } },
      quotations: { select: { id: true, quoteNumber: true, issuedAt: true, netAmount: true, status: true }, orderBy: { issuedAt: "desc" } },
    },
  });
  if (!patient) throw { status: 404, message: "Patient not found." };
  const pendingCorrection = await prisma.approval.findFirst({
    where: { subjectType: "patient_correction", subjectId: patient.id, status: "pending" },
  });
  res.json({ patient: withAge(patient), pendingCorrection });
}));

// POST /api/patients — register. Body: { name, dateOfBirth | ageYears, sex,
// phone, confirmedDistinct? }. An existing patient with the same details
// comes back with 200 and existed: true. A probable look-alike is a 409
// listing them, unless confirmedDistinct.
router.post("/", requireAuth, requireRole(...RECEPTION), route("Could not register the patient.", async (req, res) => {
  let result;
  try {
    result = await transaction((tx) => registerPatient(tx, req.body));
  } catch (err) {
    // Two technicians registering the same person at the same moment: the
    // unique identity key let one in; the other now simply finds them.
    if (err.code !== "P2002") throw err;
    result = await transaction((tx) => registerPatient(tx, req.body));
  }
  res.status(result.existed ? 200 : 201).json({ patient: withAge(result.patient), existed: result.existed });
}));

// POST /api/patients/:id/corrections — propose changed mandatory fields
// (any of name, dateOfBirth | ageYears, sex, phone). A technician's waits
// for a pathologist's approval; a pathologist's or the lead's applies at once.
router.post("/:id/corrections", requireAuth, requireRole(...RECEPTION), route("Could not record the correction.", async (req, res) => {
  const approval = await transaction((tx) => proposeCorrection(tx, req.params.id, req.body, req.session.user));
  res.status(201).json({ approval });
}));

module.exports = router;
