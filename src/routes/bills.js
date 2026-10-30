const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, LEAD, RECEPTION } = require("../middleware/auth");
const { parseInstant } = require("../utils/istDate");
const { route, transaction } = require("../utils/route");
const billing = require("../services/billing");

const router = express.Router();

const READERS = [...RECEPTION, "accountant"];
const LIST_INCLUDE = {
  patient: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  referringDoctor: true,
  panel: { select: { id: true, name: true } },
  approvals: true,
};

// Runs a change to one bill in a transaction and answers with the bill as it now is.
const changeBill = (fallback, change) =>
  route(fallback, async (req, res) => {
    const bill = await transaction(async (tx) => {
      await change(tx, req);
      return billing.getBill(tx, req.params.id);
    });
    res.json({ bill });
  });

// GET /api/bills?q=&status= — newest first, up to 100. q matches a bill
// number, or a patient's name, phone or patient number.
router.get("/", requireAuth, requireRole(...READERS), route("Could not load bills.", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const where = {
    ...(req.query.status && { status: req.query.status }),
    ...(q && {
      OR: [
        { billNumber: q },
        { patient: { patientNumber: q } },
        { patient: { phone: { contains: q } } },
        { patient: { name: { contains: q, mode: "insensitive" } } },
      ],
    }),
  };
  const bills = await prisma.bill.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ bills: bills.map(billing.presentBill) });
}));

// GET /api/bills/revisits?until=YYYY-MM-DD — samples patients are due back
// for, up to the end of that IST day (default: all), soonest first.
router.get("/revisits", requireAuth, requireRole(...RECEPTION), route("Could not load revisits.", async (req, res) => {
  const until = req.query.until ? parseInstant(`${req.query.until}T23:59:59.999+05:30`, "until") : null;
  const collections = await prisma.sampleCollection.findMany({
    where: { status: "pending", ...(until && { dueAt: { lte: until } }), billItem: { status: "active" } },
    include: {
      test: { select: { id: true, code: true, name: true } },
      billItem: { select: { id: true, code: true, bill: { select: { id: true, billNumber: true, patient: true } } } },
    },
    orderBy: { dueAt: "asc" },
  });
  res.json({ collections });
}));

// GET /api/bills/:id — everything about one bill, with its report holds.
router.get("/:id", requireAuth, requireRole(...READERS), route("Could not load the bill.", async (req, res) => {
  res.json({ bill: await billing.getBill(prisma, req.params.id) });
}));

// POST /api/bills/preview — what the bill form shows before saving: priced
// lines, totals and overlap warnings. Same body as POST /api/bills.
router.post("/preview", requireAuth, requireRole(...RECEPTION), route("Could not price the bill.", async (req, res) => {
  res.json(await transaction((tx) => billing.previewBill(tx, req.body)));
}));

// POST /api/bills — see createBill in services/billing.js for the body.
router.post("/", requireAuth, requireRole(...RECEPTION), route("Could not create the bill.", async (req, res) => {
  const bill = await transaction(async (tx) => billing.getBill(tx, await billing.createBill(tx, req.body, req.session.user)));
  res.status(201).json({ bill });
}));

// PATCH /api/bills/:id/discount — Body: { discountAmount } (the bill-level total).
router.patch("/:id/discount", requireAuth, requireRole(...RECEPTION), changeBill("Could not change the discount.", (tx, req) =>
  billing.changeDiscount(tx, req.params.id, req.body.discountAmount, req.session.user)
));

// PATCH /api/bills/:id/cancel-items — Body: { itemIds, reason, discountAmount?, refundMode? }.
router.patch("/:id/cancel-items", requireAuth, requireRole(...RECEPTION), changeBill("Could not cancel.", (tx, req) =>
  billing.cancelItems(tx, req.params.id, req.body, req.session.user)
));

// PATCH /api/bills/:id/samples — Body: { collectionIds, collectedAt? }.
router.patch("/:id/samples", requireAuth, requireRole(...RECEPTION), changeBill("Could not record the samples.", (tx, req) =>
  billing.collectSamples(tx, req.params.id, req.body, req.session.user)
));

// PATCH /api/bills/:id/expected-report — Body: { expectedReportAt } (null clears it).
router.patch("/:id/expected-report", requireAuth, requireRole(...RECEPTION), changeBill("Could not save the report time.", async (tx, req) => {
  await billing.lockBill(tx, req.params.id);
  await tx.bill.update({ where: { id: req.params.id }, data: { expectedReportAt: parseInstant(req.body.expectedReportAt, "expectedReportAt") } });
}));

// PATCH /api/bills/:id/reassign-technician — lead. Body: { technicianId }.
// Moves the bill to another reception user's Day Sheet and analytics; every
// move is kept (append-only), and payments stay with whoever took them.
router.patch("/:id/reassign-technician", requireAuth, requireRole(...LEAD), changeBill("Could not reassign the bill.", async (tx, req) => {
  const bill = await billing.lockBill(tx, req.params.id);
  const target = req.body.technicianId ? await tx.user.findUnique({ where: { id: req.body.technicianId } }) : null;
  if (!target || target.isDeleted || !RECEPTION.includes(target.role)) {
    throw { status: 400, message: "Choose an active technician or pathologist." };
  }
  if (target.id === bill.createdById) throw { status: 400, message: "This bill is already assigned to them." };
  await tx.billReassignment.create({
    data: { billId: bill.id, fromTechnicianId: bill.createdById, toTechnicianId: target.id, reassignedById: req.session.user.id },
  });
  await tx.bill.update({ where: { id: bill.id }, data: { createdById: target.id } });
}));

module.exports = router;
