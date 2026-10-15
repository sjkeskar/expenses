const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");
const { toPaise, fromPaise } = require("../utils/money");

const router = express.Router();

// All three write handlers below follow the same two rules, both of which
// exist because of real bugs:
//
// 1. Lock the bill row FIRST, then read it (see the comment in POST).
// 2. Do every amount calculation in integer paise, never in floats
//    (see src/utils/money.js).
//
// Interactive transactions get an explicit 10s timeout rather than
// Prisma's 5s default, since that budget now has to absorb lock waits as
// well as the work itself — with 6+ concurrent operators, several
// payments can queue on the same bill.
const TX_TIMEOUT_MS = 10_000;

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

  // Validated as finite numbers above, so the conversion is safe here.
  const amountPaise = toPaise(amount);
  const discountPaise = toPaise(discount);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Lock the bill row BEFORE reading it. Under READ COMMITTED every
        // statement takes a fresh snapshot, so the findUnique that runs
        // after the lock is granted sees whatever a competing transaction
        // committed while we waited. Reading first and locking second —
        // what this used to do — reads a stale balance and then happily
        // validates against it, which is how two simultaneous payments
        // could between them collect more than the bill was worth.
        await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${billId} FOR UPDATE`;
        const bill = await tx.bill.findUnique({ where: { id: billId } });
        if (!bill) {
          throw { status: 404, message: "Bill not found." };
        }
        const balancePaise = toPaise(bill.balance);
        if (balancePaise <= 0) {
          throw { status: 400, message: "This bill is already fully paid." };
        }
        const totalPaise = amountPaise + discountPaise;
        if (totalPaise > balancePaise) {
          throw {
            status: 400,
            message: `amountCollected + discountAmount (${fromPaise(totalPaise)}) exceeds the remaining balance (${fromPaise(balancePaise)}).`,
          };
        }

        const transaction = await tx.transaction.create({
          data: {
            billId: bill.id,
            clientId: bill.clientId,
            amountCollected: fromPaise(amountPaise),
            discountAmount: fromPaise(discountPaise),
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

        const newBalancePaise = balancePaise - totalPaise;
        const newBillDiscountPaise = toPaise(bill.discountAmount) + discountPaise;
        const newBillNetPaise = toPaise(bill.originalAmount) - newBillDiscountPaise;

        await tx.bill.update({
          where: { id: bill.id },
          data: {
            balance: fromPaise(newBalancePaise),
            discountAmount: fromPaise(newBillDiscountPaise),
            netAmount: fromPaise(newBillNetPaise),
            status: newBalancePaise <= 0 ? "fully_paid" : "pending",
          },
        });

        return transaction;
      },
      { timeout: TX_TIMEOUT_MS }
    );

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
//
// Refunded bills are off limits: the refund already zeroed the balance
// and snapshotted refundedAmount, so recalculating a balance from an
// edited payment would quietly drop the bill back to "pending" and lose
// the refund (see bugs/Closed/BUG-002).
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
    const updated = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.transaction.findUnique({ where: { id: req.params.id } });
        if (!existing || existing.isDeleted) {
          throw { status: 404, message: "Transaction not found." };
        }

        // Lock the parent bill before reading it — same reasoning as POST.
        await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${existing.billId} FOR UPDATE`;
        const bill = await tx.bill.findUnique({ where: { id: existing.billId } });
        if (bill.status === "refunded") {
          throw {
            status: 400,
            message: "This bill has been refunded; its payments can no longer be changed.",
          };
        }

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

        const newAmountPaise = toPaise(newAmount);
        const newDiscountPaise = toPaise(newDiscount);

        // Undo this transaction's old amount+discount contribution first.
        const oldTotalPaise = toPaise(existing.amountCollected) + toPaise(existing.discountAmount);
        const balanceExcludingThisPaise = toPaise(bill.balance) + oldTotalPaise;
        const discountExcludingThisPaise = toPaise(bill.discountAmount) - toPaise(existing.discountAmount);

        const newTotalPaise = newAmountPaise + newDiscountPaise;
        if (newTotalPaise > balanceExcludingThisPaise) {
          throw {
            status: 400,
            message: `amountCollected + discountAmount (${fromPaise(newTotalPaise)}) would exceed the bill's balance.`,
          };
        }
        const newBillBalancePaise = balanceExcludingThisPaise - newTotalPaise;
        const newBillDiscountPaise = discountExcludingThisPaise + newDiscountPaise;
        const newBillNetPaise = toPaise(bill.originalAmount) - newBillDiscountPaise;

        const transaction = await tx.transaction.update({
          where: { id: existing.id },
          data: {
            amountCollected: fromPaise(newAmountPaise),
            discountAmount: fromPaise(newDiscountPaise),
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
            balance: fromPaise(newBillBalancePaise),
            discountAmount: fromPaise(newBillDiscountPaise),
            netAmount: fromPaise(newBillNetPaise),
            status: newBillBalancePaise <= 0 ? "fully_paid" : "pending",
          },
        });

        return transaction;
      },
      { timeout: TX_TIMEOUT_MS }
    );

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
//
// Refunded bills are off limits here for the same reason as in PATCH:
// restoring a balance onto a refunded bill would silently un-refund it.
router.delete("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.transaction.findUnique({ where: { id: req.params.id } });
        if (!existing || existing.isDeleted) {
          throw { status: 404, message: "Transaction not found." };
        }

        // Lock the parent bill before reading it — same reasoning as POST.
        await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${existing.billId} FOR UPDATE`;
        const bill = await tx.bill.findUnique({ where: { id: existing.billId } });
        if (bill.status === "refunded") {
          throw {
            status: 400,
            message: "This bill has been refunded; its payments can no longer be changed.",
          };
        }

        const restoredTotalPaise = toPaise(existing.amountCollected) + toPaise(existing.discountAmount);
        const restoredBalancePaise = toPaise(bill.balance) + restoredTotalPaise;
        const restoredBillDiscountPaise = toPaise(bill.discountAmount) - toPaise(existing.discountAmount);
        const restoredBillNetPaise = toPaise(bill.originalAmount) - restoredBillDiscountPaise;

        await tx.transaction.update({
          where: { id: existing.id },
          data: { isDeleted: true, updatedById: userId },
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: {
            balance: fromPaise(restoredBalancePaise),
            discountAmount: fromPaise(restoredBillDiscountPaise),
            netAmount: fromPaise(restoredBillNetPaise),
            status: restoredBalancePaise <= 0 ? "fully_paid" : "pending",
          },
        });

        return { id: existing.id, isDeleted: true };
      },
      { timeout: TX_TIMEOUT_MS }
    );

    res.json({ transaction: result });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not delete transaction." });
  }
});

module.exports = router;
