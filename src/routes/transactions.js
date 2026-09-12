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
// Body: { billId, amountCollected, mode, discountAmount? }
//
// discountAmount is an ADDITIONAL discount given at payment time, on top
// of whatever discount the bill already had from creation (confirmed
// decision). Both the amount actually collected AND this discount reduce
// the bill's balance; the discount also gets folded into the bill's
// running discountAmount/netAmount totals, so existing analytics
// (Operator-wise "Discount Given", Location-wise, etc. — which read
// straight from Bill.discountAmount) pick it up automatically with no
// separate reporting logic needed.
//
// The logged-in user is recorded as both operator_id and created_by.
router.post("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { billId, amountCollected, mode, discountAmount } = req.body;
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
  const discount = Number(discountAmount || 0);
  if (!Number.isFinite(discount) || discount < 0) {
    return res.status(400).json({ error: "discountAmount cannot be negative." });
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
      const total = amount + discount;
      if (total > Number(bill.balance)) {
        throw {
          status: 400,
          message: `amountCollected + discountAmount (${total}) exceeds the remaining balance (${bill.balance}).`,
        };
      }

      const transaction = await tx.transaction.create({
        data: {
          billId: bill.id,
          clientId: bill.clientId,
          amountCollected: amount,
          discountAmount: discount,
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

      const newBalance = Number(bill.balance) - total;
      const newBillDiscount = Number(bill.discountAmount) + discount;
      const newBillNet = Number(bill.originalAmount) - newBillDiscount;

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          balance: newBalance,
          discountAmount: newBillDiscount,
          netAmount: newBillNet,
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

// PATCH /api/transactions/:id — operator + admin. Corrects a mis-entered
// transaction (amount, discount, and/or mode).
//
// Recalculates the parent bill's balance/discountAmount/netAmount by
// first "undoing" this transaction's OLD amount+discount contribution,
// then re-applying whatever the NEW amount+discount should be — so
// editing a transaction that included a discount doesn't leave the
// bill's discount total or balance out of sync.
router.patch("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { amountCollected, mode, discountAmount } = req.body;
  const userId = req.session.user.id;

  if (amountCollected === undefined && !mode && discountAmount === undefined) {
    return res.status(400).json({ error: "Provide amountCollected, discountAmount, and/or mode to update." });
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
      const newDiscount =
        discountAmount !== undefined ? Number(discountAmount) : Number(existing.discountAmount);

      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        throw { status: 400, message: "amountCollected must be a positive number." };
      }
      if (!Number.isFinite(newDiscount) || newDiscount < 0) {
        throw { status: 400, message: "discountAmount cannot be negative." };
      }

      // Undo this transaction's old amount+discount contribution first.
      const oldTotal = Number(existing.amountCollected) + Number(existing.discountAmount);
      const balanceExcludingThis = Number(bill.balance) + oldTotal;
      const discountExcludingThis = Number(bill.discountAmount) - Number(existing.discountAmount);

      const newTotal = newAmount + newDiscount;
      if (newTotal > balanceExcludingThis) {
        throw {
          status: 400,
          message: `amountCollected + discountAmount (${newTotal}) would exceed the bill's balance.`,
        };
      }
      const newBillBalance = balanceExcludingThis - newTotal;
      const newBillDiscount = discountExcludingThis + newDiscount;
      const newBillNet = Number(bill.originalAmount) - newBillDiscount;

      const transaction = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          amountCollected: newAmount,
          discountAmount: newDiscount,
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
          discountAmount: newBillDiscount,
          netAmount: newBillNet,
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

// DELETE /api/transactions/:id — soft delete. Restores BOTH the amount
// collected AND any discount given back onto the bill's balance, and
// removes the discount's contribution from the bill's discountAmount/
// netAmount totals — otherwise deleting a discounted transaction would
// leave that discount "stuck" on the bill permanently.
router.delete("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.isDeleted) {
        throw { status: 404, message: "Transaction not found." };
      }

      const bill = await tx.bill.findUnique({ where: { id: existing.billId } });
      const restoredTotal = Number(existing.amountCollected) + Number(existing.discountAmount);
      const restoredBalance = Number(bill.balance) + restoredTotal;
      const restoredBillDiscount = Number(bill.discountAmount) - Number(existing.discountAmount);
      const restoredBillNet = Number(bill.originalAmount) - restoredBillDiscount;

      await tx.transaction.update({
        where: { id: existing.id },
        data: { isDeleted: true, updatedById: userId },
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          balance: restoredBalance,
          discountAmount: restoredBillDiscount,
          netAmount: restoredBillNet,
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
