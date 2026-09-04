const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");

const router = express.Router();


// GET /api/transactions — operator + admin. Optional ?billId= filter.
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { billId } = req.query;
  const transactions = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      ...(billId ? { billId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      bill: { select: { id: true, billNumber: true } },
      operator: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ transactions });
});

// POST /api/transactions — operator + admin.
// Body: { billId, amountCollected, mode }
// The logged-in user is recorded as both operator_id and created_by.
router.post("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { billId, amountCollected, mode } = req.body;
  const userId = req.session.user.id;

  if (!billId || amountCollected === undefined || !mode) {
    return res.status(400).json({ error: "billId, amountCollected, and mode are required." });
  }
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
  }
  const amount = Number(amountCollected);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amountCollected must be a positive number." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) {
        throw { status: 404, message: "Bill not found." };
      }
      if (Number(bill.balance) <= 0) {
        throw { status: 400, message: "This bill is already fully paid." };
      }
      if (amount > Number(bill.balance)) {
        throw {
          status: 400,
          message: `amountCollected (${amount}) exceeds the remaining balance (${bill.balance}).`,
        };
      }

      const transaction = await tx.transaction.create({
        data: {
          billId: bill.id,
          clientId: bill.clientId,
          amountCollected: amount,
          mode,
          operatorId: userId,
          createdById: userId,
        },
        include: {
          client: { select: { id: true, name: true } },
          bill: { select: { id: true, billNumber: true } },
          operator: { select: { id: true, name: true } },
        },
      });

      const newBalance = Number(bill.balance) - amount;
      await tx.bill.update({
        where: { id: bill.id },
        data: {
          balance: newBalance,
          status: newBalance <= 0 ? "fully_paid" : "pending",
        },
      });

      return transaction;
    });

    res.status(201).json({ transaction: result });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not record transaction." });
  }
});

// PATCH /api/transactions/:id — operator + admin. Corrects a mis-entered transaction.
// Recalculates the parent bill's balance/status based on the amount difference.
router.patch("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { amountCollected, mode } = req.body;
  const userId = req.session.user.id;

  if (amountCollected === undefined && !mode) {
    return res.status(400).json({ error: "Provide amountCollected and/or mode to update." });
  }
  if (mode && !VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.isDeleted) {
        throw { status: 404, message: "Transaction not found." };
      }

      const bill = await tx.bill.findUnique({ where: { id: existing.billId } });
      const newAmount =
        amountCollected !== undefined ? Number(amountCollected) : Number(existing.amountCollected);

      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        throw { status: 400, message: "amountCollected must be a positive number." };
      }

      // Recompute balance as if this transaction's old amount never happened,
      // then apply the new amount.
      const balanceExcludingThis = Number(bill.balance) + Number(existing.amountCollected);
      if (newAmount > balanceExcludingThis) {
        throw {
          status: 400,
          message: `amountCollected (${newAmount}) would exceed the bill's balance.`,
        };
      }
      const newBillBalance = balanceExcludingThis - newAmount;

      const transaction = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          amountCollected: newAmount,
          mode: mode || existing.mode,
          updatedById: userId,
        },
        include: {
          client: { select: { id: true, name: true } },
          bill: { select: { id: true, billNumber: true } },
          operator: { select: { id: true, name: true } },
        },
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          balance: newBillBalance,
          status: newBillBalance <= 0 ? "fully_paid" : "pending",
        },
      });

      return transaction;
    });

    res.json({ transaction: updated });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not update transaction." });
  }
});

// DELETE /api/transactions/:id — soft delete. Adds the amount back to bill balance.
router.delete("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.isDeleted) {
        throw { status: 404, message: "Transaction not found." };
      }

      const bill = await tx.bill.findUnique({ where: { id: existing.billId } });
      const restoredBalance = Number(bill.balance) + Number(existing.amountCollected);

      await tx.transaction.update({
        where: { id: existing.id },
        data: { isDeleted: true, updatedById: userId },
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          balance: restoredBalance,
          status: restoredBalance <= 0 ? "fully_paid" : "pending",
        },
      });

      return { id: existing.id, isDeleted: true };
    });

    res.json({ transaction: result });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not delete transaction." });
  }
});

module.exports = router;
