const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, OVERSIGHT } = require("../middleware/auth");
const { parseDateRange } = require("../utils/dateRange");
const { route } = require("../utils/route");

const router = express.Router();

// Analytics for the lead and the accountant (pivot.md §6.10): day-,
// technician-, location-, referral-, payer- and test-wise summaries, patient
// balances, and the accountant's period tally.
//
// Money rules: "collected" on a day = payments − refunds recorded that day.
// Billed totals already exclude cancelled items (bills store totals of their
// active items only), and fully cancelled bills drop out of bill counts.
// Days are IST calendar days via AT TIME ZONE on timestamptz columns (README
// "Timezone").
router.use(requireAuth, requireRole(...OVERSIGHT));

// Every money movement, signed: payments and settlements in, refunds out.
// The same rows the day sheets are built from, so the two always agree.
const MOVEMENTS = `
  SELECT t."createdAt" AS at, t."mode"::text AS mode, t."amountCollected" AS amount, t."operatorId" AS user_id,
         t."billId" AS bill_id, 1 AS is_payment, t."kind"::text AS kind
  FROM "transactions" t WHERE NOT t."isDeleted"
  UNION ALL
  SELECT r."createdAt", r."mode"::text, -r."amount", r."createdById", r."billId", 0, 'refund' FROM "refunds" r`;

// Bills raised in the period, cancelled ones left out: their totals per group.
const BILLED = `COUNT(*)::int AS bills, SUM(b."originalAmount")::float AS total_billed,
  SUM(b."discountAmount")::float AS total_discount, SUM(b."netAmount")::float AS net_billed, SUM(b."balance")::float AS total_pending`;
const IN_PERIOD = `b."status" != 'cancelled' AND b."createdAt" >= $1 AND b."createdAt" < $2`;

// GET /api/analytics/day-wise?startDate=&endDate=
router.get("/day-wise", route("Could not load the day-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const dayWise = await prisma.$queryRawUnsafe(
    `SELECT DATE(at AT TIME ZONE 'Asia/Kolkata') AS day,
       SUM(amount)::float AS net_collected,
       COUNT(*) FILTER (WHERE is_payment = 1)::int AS payment_count,
       COUNT(*) FILTER (WHERE is_payment = 0)::int AS refund_count,
       COALESCE(-SUM(amount) FILTER (WHERE is_payment = 0), 0)::float AS refund_total,
       COALESCE(SUM(amount) FILTER (WHERE mode = 'cash'), 0)::float AS cash,
       COALESCE(SUM(amount) FILTER (WHERE mode = 'credit_card'), 0)::float AS credit_card,
       COALESCE(SUM(amount) FILTER (WHERE mode = 'upi'), 0)::float AS upi
     FROM (${MOVEMENTS}) m WHERE at >= $1 AND at < $2
     GROUP BY 1 ORDER BY 1 DESC`,
    from,
    to
  );
  res.json({ dayWise });
}));

// GET /api/analytics/technician-wise?startDate=&endDate= — per user: money
// collected (by who took it) and bills raised (by the bill's current
// technician), merged into one row each.
router.get("/technician-wise", route("Could not load the technician-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const collections = await prisma.$queryRawUnsafe(
    `SELECT user_id, SUM(amount)::float AS net_collected, COUNT(*) FILTER (WHERE is_payment = 1)::int AS payment_count
     FROM (${MOVEMENTS}) m WHERE at >= $1 AND at < $2 GROUP BY user_id`,
    from,
    to
  );
  const billing = await prisma.$queryRaw`
    SELECT "createdById" AS user_id, SUM("originalAmount")::float AS total_billed, SUM("discountAmount")::float AS total_discount,
           SUM("balance")::float AS total_pending, COUNT(*)::int AS bills_created
    FROM "bills" WHERE "status" != 'cancelled' AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY "createdById"`;

  const rows = new Map();
  const empty = { net_collected: 0, payment_count: 0, total_billed: 0, total_discount: 0, total_pending: 0, bills_created: 0 };
  for (const row of [...collections, ...billing]) rows.set(row.user_id, { ...empty, ...rows.get(row.user_id), ...row });
  const users = await prisma.user.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, name: true } });
  const technicianWise = [...rows.values()]
    .map((row) => ({ ...row, user_name: users.find((u) => u.id === row.user_id)?.name }))
    .sort((a, b) => b.net_collected - a.net_collected);
  res.json({ technicianWise });
}));

// GET /api/analytics/location-wise?startDate=&endDate= — bills raised per
// branch/centre; pending is each bill's current balance.
router.get("/location-wise", route("Could not load the location-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const locationWise = await prisma.$queryRaw`
    SELECT l."id" AS location_id, l."name" AS location_name, l."type"::text AS location_type,
           SUM(b."originalAmount")::float AS total_billed, SUM(b."discountAmount")::float AS total_discount,
           SUM(b."balance")::float AS total_pending, COUNT(*)::int AS bills_created
    FROM "bills" b JOIN "locations" l ON l."id" = b."locationId"
    WHERE b."status" != 'cancelled' AND b."createdAt" >= ${from} AND b."createdAt" < ${to}
    GROUP BY l."id", l."name", l."type" ORDER BY total_billed DESC`;
  res.json({ locationWise });
}));

// GET /api/analytics/referral-wise?startDate=&endDate= — walk-ins, and each
// referring doctor (a doctor referral may name none).
router.get("/referral-wise", route("Could not load the referral-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const referralWise = await prisma.$queryRawUnsafe(
    `SELECT b."referralType"::text AS referral_type, d."id" AS doctor_id, d."name" AS doctor_name, ${BILLED}
     FROM "bills" b LEFT JOIN "referring_doctors" d ON d."id" = b."referringDoctorId"
     WHERE ${IN_PERIOD} GROUP BY 1, 2, 3 ORDER BY net_billed DESC`,
    from,
    to
  );
  res.json({ referralWise });
}));

// GET /api/analytics/payer-wise?startDate=&endDate= — self-pay, and each panel.
router.get("/payer-wise", route("Could not load the payer-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const payerWise = await prisma.$queryRawUnsafe(
    `SELECT b."payerType"::text AS payer_type, p."id" AS panel_id, p."name" AS panel_name, p."type"::text AS panel_type, ${BILLED}
     FROM "bills" b LEFT JOIN "panels" p ON p."id" = b."panelId"
     WHERE ${IN_PERIOD} GROUP BY 1, 2, 3, 4 ORDER BY net_billed DESC`,
    from,
    to
  );
  res.json({ payerWise });
}));

// GET /api/analytics/test-wise?startDate=&endDate= — per catalog item on
// bills raised in the period: how often it was billed and for how much
// (active lines), and how often it was cancelled.
router.get("/test-wise", route("Could not load the test-wise summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const testWise = await prisma.$queryRaw`
    SELECT c."id" AS item_id, c."code" AS code, c."name" AS name, c."kind"::text AS kind,
           COUNT(*) FILTER (WHERE i."status" = 'active')::int AS billed_count,
           COALESCE(SUM(i."price") FILTER (WHERE i."status" = 'active'), 0)::float AS billed_amount,
           COUNT(*) FILTER (WHERE i."status" = 'cancelled')::int AS cancelled_count
    FROM "bill_items" i JOIN "bills" b ON b."id" = i."billId" JOIN "catalog_items" c ON c."id" = i."catalogItemId"
    WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to}
    GROUP BY c."id", c."code", c."name", c."kind" ORDER BY billed_amount DESC, code`;
  res.json({ testWise });
}));

// GET /api/analytics/tally?startDate=&endDate= — the accountant's audit
// figures for a period (pivot.md §6.10): payments, settlements, refunds and
// net collected by mode (equal to the sum of the period's day sheets);
// panels' outstanding balances as of now; and the discounts on bills raised
// in the period, approved or still pending.
router.get("/tally", route("Could not load the tally.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const [byMode, panels, [discounts]] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT mode,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'payment'), 0)::float AS payments,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'settlement'), 0)::float AS settlements,
         COALESCE(-SUM(amount) FILTER (WHERE kind = 'refund'), 0)::float AS refunds,
         SUM(amount)::float AS net
       FROM (${MOVEMENTS}) m WHERE at >= $1 AND at < $2 GROUP BY mode ORDER BY mode`,
      from,
      to
    ),
    prisma.$queryRaw`
      SELECT p."id" AS panel_id, p."name" AS panel_name, p."type"::text AS panel_type,
             COUNT(*)::int AS pending_bills, SUM(b."balance")::float AS outstanding
      FROM "bills" b JOIN "panels" p ON p."id" = b."panelId"
      WHERE b."payerType" = 'panel' AND b."status" = 'pending'
      GROUP BY p."id", p."name", p."type" ORDER BY outstanding DESC`,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(d.amount) FILTER (WHERE NOT d.pending), 0)::float AS approved,
             COUNT(*) FILTER (WHERE NOT d.pending)::int AS approved_count,
             COALESCE(SUM(d.amount) FILTER (WHERE d.pending), 0)::float AS pending,
             COUNT(*) FILTER (WHERE d.pending)::int AS pending_count
      FROM (
        SELECT b."discountAmount" AS amount,
               EXISTS (SELECT 1 FROM "approvals" a WHERE a."billId" = b."id" AND a."subjectType" = 'bill_discount' AND a."status" = 'pending') AS pending
        FROM "bills" b WHERE b."discountAmount" > 0 AND b."createdAt" >= ${from} AND b."createdAt" < ${to}
      ) d`,
  ]);
  const sum = (field) => Math.round(byMode.reduce((total, row) => total + row[field] * 100, 0)) / 100;
  res.json({
    tally: {
      byMode,
      totals: { payments: sum("payments"), settlements: sum("settlements"), refunds: sum("refunds"), net: sum("net") },
      panels,
      discounts,
    },
  });
}));

// GET /api/analytics/patient-outstanding — current balances, not date-filtered.
router.get("/patient-outstanding", route("Could not load outstanding balances.", async (req, res) => {
  const patientOutstanding = await prisma.$queryRaw`
    SELECT p."id" AS patient_id, p."name" AS patient_name, p."patientNumber" AS patient_number,
           SUM(b."balance")::float AS outstanding_balance, COUNT(*)::int AS pending_bill_count
    FROM "patients" p JOIN "bills" b ON b."patientId" = p."id"
    WHERE b."status" = 'pending'
    GROUP BY p."id", p."name", p."patientNumber" ORDER BY outstanding_balance DESC`;
  res.json({ patientOutstanding });
}));

// GET /api/analytics/patient-daily/:patientId?startDate=&endDate=
router.get("/patient-daily/:patientId", route("Could not load the patient summary.", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const patientDaily = await prisma.$queryRawUnsafe(
    `SELECT DATE(m.at AT TIME ZONE 'Asia/Kolkata') AS day, SUM(m.amount)::float AS net_collected, COUNT(*)::int AS movement_count
     FROM (${MOVEMENTS}) m JOIN "bills" b ON b."id" = m.bill_id
     WHERE b."patientId" = $1 AND m.at >= $2 AND m.at < $3
     GROUP BY 1 ORDER BY 1 DESC`,
    req.params.patientId,
    from,
    to
  );
  res.json({ patientDaily });
}));

// GET /api/analytics/patient-ledger/:patientId — every bill with its lines,
// payments and refunds; not date-filtered.
router.get("/patient-ledger/:patientId", route("Could not load the ledger.", async (req, res) => {
  const ledger = await prisma.bill.findMany({
    where: { patientId: req.params.patientId },
    include: {
      items: { orderBy: { position: "asc" } },
      transactions: { where: { isDeleted: false }, include: { operator: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      refunds: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ledger });
}));

module.exports = router;
