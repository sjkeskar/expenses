const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION, OVERSIGHT } = require("../middleware/auth");
const { VALID_MODES } = require("../utils/paymentModes");
const { toPaise, fromPaise } = require("../utils/money");
const { getIstDateString, isValidDateString } = require("../utils/istDate");
const { parseDateRange } = require("../utils/dateRange");
const { route } = require("../utils/route");
const { presentBill } = require("../services/billing");

const router = express.Router();

const BILL_REF = { bill: { select: { id: true, billNumber: true, patient: { select: { id: true, name: true } } } } };

// GET /api/daysheet?date=YYYY-MM-DD&userId= — what one user did on an IST
// day (pivot.md §6.7): every payment, settlement and refund they recorded,
// on any bill, with totals by mode (refunds subtracted: the cash hand-over
// figure), plus the bills they created. Built from money movements, so a
// period's tally always equals the sum of its day sheets. Anyone sees their
// own; the lead and the accountant anyone's.
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load the day sheet.", async (req, res) => {
  const date = req.query.date || getIstDateString();
  if (!isValidDateString(date)) throw { status: 400, message: "date must be a valid date in YYYY-MM-DD format." };
  const userId = req.query.userId || req.session.user.id;
  if (userId !== req.session.user.id && !OVERSIGHT.includes(req.session.user.role)) {
    throw { status: 403, message: "You can only open your own day sheet." };
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } });
  if (!user) throw { status: 404, message: "User not found." };

  const { from, to } = parseDateRange({ startDate: date, endDate: date });
  const createdAt = { gte: from, lt: to };
  const [payments, refunds, bills] = await Promise.all([
    prisma.transaction.findMany({ where: { operatorId: userId, isDeleted: false, createdAt }, include: BILL_REF }),
    prisma.refund.findMany({ where: { createdById: userId, createdAt }, include: BILL_REF }),
    prisma.bill.findMany({
      where: { createdById: userId, createdAt },
      include: { patient: true, items: { where: { status: "active" } }, referringDoctor: true, panel: { select: { id: true, name: true } }, approvals: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const movements = [
    ...payments.map((t) => ({ at: t.createdAt, kind: t.kind, mode: t.mode, paise: toPaise(t.amountCollected), bill: t.bill })),
    ...refunds.map((r) => ({ at: r.createdAt, kind: "refund", mode: r.mode, paise: -toPaise(r.amount), bill: r.bill })),
  ].sort((a, b) => a.at - b.at);

  const totalsPaise = Object.fromEntries(VALID_MODES.map((mode) => [mode, 0]));
  for (const m of movements) totalsPaise[m.mode] += m.paise;
  const totals = Object.fromEntries(Object.entries(totalsPaise).map(([mode, p]) => [mode, fromPaise(p)]));
  totals.total = fromPaise(movements.reduce((sum, m) => sum + m.paise, 0));

  res.json({
    date,
    user,
    money: movements.map(({ paise, ...m }) => ({ ...m, amount: fromPaise(paise) })),
    totals,
    bills: bills.map(presentBill),
  });
}));

// GET /api/daysheet/users — lead or accountant: whose day sheet they can
// open (everyone who takes money, deactivated accounts included).
router.get("/users", requireAuth, requireRole(...OVERSIGHT), route("Could not load users.", async (req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: RECEPTION } },
    select: { id: true, name: true, role: true, isDeleted: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
}));

module.exports = router;
