const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");
const { toPaise, fromPaise } = require("../utils/money");

const router = express.Router();

// Settlement locks rows and so needs more than Prisma's 5s default
// transaction timeout — that budget now has to absorb lock waits as well
// as the work itself.
const TX_TIMEOUT_MS = 10_000;

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

  // Summed in integer paise, then converted back once — adding Decimals
  // as floats drifts once there are enough fractional balances in the
  // list (see src/utils/money.js).
  const outstandingPaise = pendingBills.reduce((sum, b) => sum + toPaise(b.balance), 0);

  res.json({
    company: { id: company.id, name: company.name },
    totalOutstanding: Number(fromPaise(outstandingPaise)),
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
  // A repeated bill id is rejected rather than silently de-duplicated: a
  // client that sent the same bill twice has a bug of its own, and
  // quietly settling the unique set hides it. This check also used to
  // surface as a baffling "one or more selected bills could not be
  // found", because the findMany below returns one row for two ids and
  // the length comparison then failed (see bugs/Closed/BUG-005).
  if (new Set(billIds).size !== billIds.length) {
    return res.status(400).json({ error: "Each bill can only be selected once." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: req.params.id } });
      if (!company) {
        throw { status: 404, message: "Company not found." };
      }

      // Lock every selected bill BEFORE reading any of them, one id at a
      // time and in sorted order.
      //
      // One id at a time, because a single `WHERE id IN (...) ORDER BY id
      // FOR UPDATE` does not reliably lock in that order — Postgres may
      // apply the sort after fetching and locking the rows. In sorted
      // order, because a deterministic lock order across concurrent
      // settlements is what stops two overlapping ones deadlocking each
      // other. And before reading, so the status/balance checks below see
      // whatever a competing payment committed while we waited.
      for (const id of [...billIds].sort()) {
        await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${id} FOR UPDATE`;
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
      let totalSettledPaise = 0;

      for (const bill of bills) {
        const appliedPaise = toPaise(bill.balance);

        await tx.transaction.create({
          data: {
            billId: bill.id,
            clientId: bill.clientId,
            amountCollected: fromPaise(appliedPaise),
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
          amountApplied: Number(fromPaise(appliedPaise)),
          newBalance: 0,
          newStatus: "fully_paid",
        });
        totalSettledPaise += appliedPaise;
      }

      return {
        company: { id: company.id, name: company.name },
        totalSettled: Number(fromPaise(totalSettledPaise)),
        breakdown,
      };
    }, { timeout: TX_TIMEOUT_MS });

    res.status(201).json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not process settlement." });
  }
});

module.exports = router;
