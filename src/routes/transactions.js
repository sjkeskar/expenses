const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");
const { toPaise, fromPaise, parseMoney } = require("../utils/money");
const { route, transaction } = require("../utils/route");
const { lockBill, recomputeTotals, recordDiscountChange } = require("../services/billing");

const router = express.Router();

const INCLUDE = { bill: { select: { id: true, billNumber: true } }, operator: { select: { id: true, name: true } } };

function parseMode(mode, { required = true } = {}) {
  if (!mode && !required) return undefined;
  if (!VALID_MODES.includes(mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(", ")}` };
  return mode;
}

// Payments can only be taken (or changed) on a bill that is still pending
// or paid; a cancelled bill's money is settled by its refunds.
function assertOpen(bill) {
  if (bill.status === "cancelled") throw { status: 400, message: "This bill is cancelled; its payments can no longer change." };
}

// GET /api/transactions?billId=
router.get("/", requireAuth, requireRole(...RECEPTION), route("Could not load payments.", async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { isDeleted: false, ...(req.query.billId && { billId: req.query.billId }) },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  res.json({ transactions });
}));

// POST /api/transactions — record a payment. Body: { billId, amountCollected,
// mode, discountAmount? }. discountAmount is an extra discount given at
// payment time: it reduces the balance, joins the bill-level discount, and
// like every discount needs approval (services/billing.js).
router.post("/", requireAuth, requireRole(...RECEPTION), route("Could not record the payment.", async (req, res) => {
  const { billId } = req.body;
  if (!billId) throw { status: 400, message: "billId is required." };
  const mode = parseMode(req.body.mode);
  const amountPaise = parseMoney(req.body.amountCollected, "amountCollected", { required: true, positive: true });
  const discountPaise = parseMoney(req.body.discountAmount, "discountAmount");

  const result = await transaction(async (tx) => {
    const bill = await lockBill(tx, billId);
    assertOpen(bill);
    const balancePaise = toPaise(bill.balance);
    if (balancePaise <= 0) throw { status: 400, message: "This bill is already fully paid." };
    if (amountPaise + discountPaise > balancePaise) {
      throw {
        status: 400,
        message: `amountCollected + discountAmount (${fromPaise(amountPaise + discountPaise)}) exceeds the remaining balance (${fromPaise(balancePaise)}).`,
      };
    }
    const created = await tx.transaction.create({
      data: { billId, amountCollected: fromPaise(amountPaise), discountAmount: fromPaise(discountPaise), mode, operatorId: req.session.user.id },
      include: INCLUDE,
    });
    const fromP = toPaise(bill.discountAmount);
    await recomputeTotals(tx, billId, { discountPaise: fromP + discountPaise });
    await recordDiscountChange(tx, billId, fromP, fromP + discountPaise, req.session.user);
    return created;
  });
  res.status(201).json({ transaction: result });
}));

// PATCH /api/transactions/:id — correct a mis-entered payment (amount,
// discount and/or mode). DELETE soft-deletes one. Both re-apply the bill's
// totals; there is no UI for either yet (BUG-006, parked).
async function changePayment(tx, id, change, user) {
  const existing = await tx.transaction.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw { status: 404, message: "Payment not found." };
  const bill = await lockBill(tx, existing.billId);
  assertOpen(bill);

  const oldDiscountP = toPaise(existing.discountAmount);
  const newDiscountP = change.isDeleted ? 0 : change.discountPaise ?? oldDiscountP;
  const updated = await tx.transaction.update({
    where: { id },
    data: {
      ...(change.amountPaise !== undefined && { amountCollected: fromPaise(change.amountPaise) }),
      discountAmount: fromPaise(newDiscountP),
      ...(change.mode && { mode: change.mode }),
      ...(change.isDeleted && { isDeleted: true }),
      updatedById: user.id,
    },
    include: INCLUDE,
  });
  const billDiscountP = toPaise(bill.discountAmount);
  const toP = billDiscountP - oldDiscountP + newDiscountP;
  await recomputeTotals(tx, bill.id, { discountPaise: toP });
  await recordDiscountChange(tx, bill.id, billDiscountP, toP, user);
  return updated;
}

router.patch("/:id", requireAuth, requireRole(...RECEPTION), route("Could not update the payment.", async (req, res) => {
  const { amountCollected, discountAmount, mode } = req.body;
  if (amountCollected === undefined && discountAmount === undefined && !mode) {
    throw { status: 400, message: "Provide amountCollected, discountAmount, and/or mode to update." };
  }
  const change = {
    amountPaise: amountCollected === undefined ? undefined : parseMoney(amountCollected, "amountCollected", { positive: true }),
    discountPaise: discountAmount === undefined ? undefined : parseMoney(discountAmount, "discountAmount"),
    mode: parseMode(mode, { required: false }),
  };
  const updated = await transaction((tx) => changePayment(tx, req.params.id, change, req.session.user));
  res.json({ transaction: updated });
}));

router.delete("/:id", requireAuth, requireRole(...RECEPTION), route("Could not delete the payment.", async (req, res) => {
  const deleted = await transaction((tx) => changePayment(tx, req.params.id, { isDeleted: true }, req.session.user));
  res.json({ transaction: { id: deleted.id, isDeleted: true } });
}));

module.exports = router;
