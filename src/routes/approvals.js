const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION, APPROVERS } = require("../middleware/auth");
const { route, transaction } = require("../utils/route");
const { reviewableBy, review, resolve } = require("../services/approvals");
// Each service defines its own approval subjects when loaded (see
// services/approvals.js); require them all so the queue knows every kind.
require("../services/billing");
require("../services/catalog");
require("../services/patients");
require("../services/doctors");

const { CATALOG_DETAIL } = require("../services/catalog");

const router = express.Router();

const INCLUDE = {
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  bill: {
    select: { id: true, billNumber: true, netAmount: true, balance: true, patient: { select: { id: true, name: true, patientNumber: true } } },
  },
};

// What a reviewer sees beside each request (pivot.md §6.2): its `subject` —
// the doctor, the patient, the catalog item as it stands now (for old → new),
// or the cancellation and its reason — and `names` for the machine-type and
// test ids inside catalog proposals.
async function withDetails(approvals) {
  const ids = (type) => approvals.filter((a) => a.subjectType === type && a.subjectId).map((a) => a.subjectId);
  const proposed = approvals.filter((a) => a.subjectType === "catalog_change" && a.payload.values).map((a) => a.payload.values);
  const [doctors, patients, items, cancellations, machineTypes, tests] = await Promise.all([
    prisma.referringDoctor.findMany({ where: { id: { in: ids("referring_doctor") } } }),
    prisma.patient.findMany({ where: { id: { in: ids("patient_correction") } }, select: { id: true, name: true, patientNumber: true } }),
    prisma.catalogItem.findMany({ where: { id: { in: ids("catalog_change") } }, include: CATALOG_DETAIL }),
    prisma.cancellation.findMany({ where: { id: { in: ids("bill_cancellation") } }, select: { id: true, reason: true } }),
    prisma.machineType.findMany({ where: { id: { in: proposed.flatMap((v) => v.machineSteps.map((s) => s.machineTypeId)) } } }),
    prisma.catalogItem.findMany({ where: { id: { in: proposed.flatMap((v) => v.components) } } }),
  ]);
  const subjects = new Map([...doctors, ...patients, ...items, ...cancellations].map((s) => [s.id, s]));
  return {
    approvals: approvals.map((a) => ({ ...a, subject: subjects.get(a.subjectId) ?? null })),
    names: Object.fromEntries([...machineTypes.map((t) => [t.id, t.name]), ...tests.map((t) => [t.id, t.code])]),
  };
}

// GET /api/approvals — pathologist or lead: the pending requests they may
// review (pathologist: discounts, cancellations, patient corrections; lead:
// those plus catalog changes and doctors), plus rejected cancellations the
// lead still has to resolve.
router.get("/", requireAuth, requireRole(...APPROVERS), route("Could not load the queue.", async (req, res) => {
  const user = req.session.user;
  const approvals = await prisma.approval.findMany({
    where: {
      OR: [
        { status: "pending", subjectType: { in: reviewableBy(user) } },
        ...(LEAD.includes(user.role) ? [{ status: "rejected", subjectType: "bill_cancellation" }] : []),
      ],
    },
    include: INCLUDE,
    orderBy: { requestedAt: "asc" },
  });
  res.json(await withDetails(approvals));
}));

// GET /api/approvals/mine — the signed-in user's own requests, newest first.
router.get("/mine", requireAuth, requireRole(...RECEPTION), route("Could not load your requests.", async (req, res) => {
  const approvals = await prisma.approval.findMany({
    where: { requestedById: req.session.user.id },
    include: INCLUDE,
    orderBy: { requestedAt: "desc" },
    take: 100,
  });
  res.json(await withDetails(approvals));
}));

// POST /api/approvals/:id/approve and /reject. Body: { note? }.
for (const decision of ["approve", "reject"]) {
  router.post(`/:id/${decision}`, requireAuth, requireRole(...APPROVERS), route("Could not record the decision.", async (req, res) => {
    const approval = await transaction((tx) => review(tx, req.params.id, decision, req.body.note, req.session.user));
    res.json({ approval });
  }));
}

// POST /api/approvals/:id/resolve — lead: a rejected cancellation has been
// dealt with, which lifts its report hold. Body: { note }.
router.post("/:id/resolve", requireAuth, requireRole(...LEAD), route("Could not mark it resolved.", async (req, res) => {
  const approval = await transaction((tx) => resolve(tx, req.params.id, req.body.note, req.session.user));
  res.json({ approval });
}));

module.exports = router;
