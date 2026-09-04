const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");

const router = express.Router();

// GET /api/companies — operator + admin. Active companies only.
// Companies are never created/deleted through a standalone screen — they
// only come into existence as a side effect of adding a "credit" category
// (see categories.js). This endpoint just lists them, for the Settle
// Company Balance picker.
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  res.json({ companies });
});

// GET /api/companies/:id/outstanding — operator + admin. This company's
// pending bills, each with enough detail (client name, bill number,
// balance, date) for a human to decide which ones to settle — since
// settlement is now a manual pick-the-bills action, not automatic FIFO
// (some bills may be disputed and should be skipped).
router.get("/:id/outstanding", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    return res.status(404).json({ error: "Company not found." });
  }

  const pendingBills = await prisma.bill.findMany({
    where: { companyId: company.id, status: "pending" },
    select: {
      id: true,
      billNumber: true,
      balance: true,
      createdAt: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const totalOutstanding = pendingBills.reduce((sum, b) => sum + Number(b.balance), 0);

  res.json({
    company: { id: company.id, name: company.name },
    totalOutstanding,
    pendingBillCount: pendingBills.length,
    pendingBills,
  });
});

// POST /api/companies/:id/settle — operator + admin.
// Body: { billIds: [...], mode }
//
// Settles a HAND-PICKED set of this company's pending bills — each
// selected bill is paid off IN FULL. This replaced an earlier FIFO
// (oldest-first, auto-distributed lump sum) design: in practice some
// bills are disputed and must be skippable individually rather than
// always settling in date order, so the person doing the settlement
// picks exactly which bills to close.
//
// Each selected bill must currently belong to this company and be
// pending — the whole settlement is rejected (no partial application) if
// any selected bill fails that check, so a stale/already-settled
// selection never silently settles only some of what was picked.
router.post("/:id/settle", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { billIds, mode } = req.body;
  const userId = req.session.user.id;

  if (!Array.isArray(billIds) || billIds.length === 0) {
    return res.status(400).json({ error: "billIds must be a non-empty array." });
  }
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: req.params.id } });
      if (!company) {
        throw { status: 404, message: "Company not found." };
      }

      const bills = await tx.bill.findMany({ where: { id: { in: billIds } } });
      if (bills.length !== billIds.length) {
        throw { status: 404, message: "One or more selected bills could not be found." };
      }
      for (const bill of bills) {
        if (bill.companyId !== company.id) {
          throw { status: 400, message: `Bill ${bill.billNumber} does not belong to this company.` };
        }
        if (bill.status !== "pending") {
          throw { status: 400, message: `Bill ${bill.billNumber} is not pending (already fully paid).` };
        }
      }

      const breakdown = [];
      let totalSettled = 0;

      for (const bill of bills) {
        const applied = Number(bill.balance);

        await tx.transaction.create({
          data: {
            billId: bill.id,
            clientId: bill.clientId,
            amountCollected: applied,
            mode,
            operatorId: userId,
            createdById: userId,
          },
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { balance: 0, status: "fully_paid" },
        });

        breakdown.push({
          billId: bill.id,
          billNumber: bill.billNumber,
          amountApplied: applied,
          newBalance: 0,
          newStatus: "fully_paid",
        });
        totalSettled += applied;
      }

      return {
        company: { id: company.id, name: company.name },
        totalSettled,
        breakdown,
      };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not process settlement." });
  }
});

module.exports = router;
