const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parseDateRange } = require("../utils/dateRange");

const router = express.Router();

// All analytics routes are admin-only (confirmed decision).
router.use(requireAuth, requireRole("admin"));

// GET /api/analytics/day-wise?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Total collected per day, plus a per-payment-mode breakdown (count +
// amount for cash/credit_card/upi) so admin can see how many transactions
// on a given day used each method.
//
// "Day" is bucketed in India Standard Time via the standard `AT TIME
// ZONE` conversion, which works correctly and unambiguously because
// "createdAt" is a timestamptz column (Postgres always stores the true
// UTC instant internally regardless of how/where it was written) — this
// is NOT the same as the old naive-timestamp `+ INTERVAL '5:30'` shift,
// which depended on assumptions about what timezone the writing process
// considered "local."
router.get("/day-wise", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const rows = await prisma.$queryRaw`
    SELECT
      DATE("createdAt" AT TIME ZONE 'Asia/Kolkata') AS day,
      SUM("amountCollected")::float AS total_collected,
      COUNT(*)::int AS transaction_count,
      COUNT(*) FILTER (WHERE "mode" = 'cash')::int AS cash_count,
      COALESCE(SUM("amountCollected") FILTER (WHERE "mode" = 'cash'), 0)::float AS cash_total,
      COUNT(*) FILTER (WHERE "mode" = 'credit_card')::int AS credit_card_count,
      COALESCE(SUM("amountCollected") FILTER (WHERE "mode" = 'credit_card'), 0)::float AS credit_card_total,
      COUNT(*) FILTER (WHERE "mode" = 'upi')::int AS upi_count,
      COALESCE(SUM("amountCollected") FILTER (WHERE "mode" = 'upi'), 0)::float AS upi_total
    FROM "transactions"
    WHERE "isDeleted" = false AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY DATE("createdAt" AT TIME ZONE 'Asia/Kolkata')
    ORDER BY day DESC;
  `;
  res.json({ dayWise: rows });
});

// GET /api/analytics/operator-wise?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Per operator: total billed, discount given, amount collected — three
// separate figures rather than one blended "total collected".
//
// Billed/discount come from bills.createdById (who raised the bill);
// collected comes from transactions.operatorId (who took the payment).
// These are two different groupings merged into one row per operator,
// because a bill and its later payments aren't always handled by the
// same person.
router.get("/operator-wise", async (req, res) => {
  const { from, to } = parseDateRange(req.query);

  const collections = await prisma.$queryRaw`
    SELECT
      u."id" AS operator_id,
      u."name" AS operator_name,
      SUM(t."amountCollected")::float AS total_collected,
      COUNT(t.*)::int AS transaction_count
    FROM "transactions" t
    JOIN "users" u ON u."id" = t."operatorId"
    WHERE t."isDeleted" = false AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
    GROUP BY u."id", u."name";
  `;

  const billing = await prisma.$queryRaw`
    SELECT
      u."id" AS operator_id,
      COALESCE(u."name", 'Unattributed (legacy bills)') AS operator_name,
      SUM(b."originalAmount")::float AS total_billed,
      SUM(b."discountAmount")::float AS total_discount,
      COUNT(b.*)::int AS bills_created
    FROM "bills" b
    LEFT JOIN "users" u ON u."id" = b."createdById"
    WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to}
    GROUP BY u."id", u."name";
  `;

  const merged = new Map();
  const keyOf = (id) => id || "unattributed";

  for (const row of collections) {
    merged.set(keyOf(row.operator_id), {
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      totalCollected: row.total_collected,
      transactionCount: row.transaction_count,
      totalBilled: 0,
      totalDiscount: 0,
      billsCreated: 0,
    });
  }

  for (const row of billing) {
    const key = keyOf(row.operator_id);
    const existing = merged.get(key) || {
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      totalCollected: 0,
      transactionCount: 0,
    };
    existing.totalBilled = row.total_billed;
    existing.totalDiscount = row.total_discount;
    existing.billsCreated = row.bills_created;
    existing.operatorName = existing.operatorName || row.operator_name;
    merged.set(key, existing);
  }

  const operatorWise = Array.from(merged.values()).sort(
    (a, b) => (b.totalCollected || 0) - (a.totalCollected || 0)
  );

  res.json({ operatorWise });
});

// GET /api/analytics/location-wise?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Per location: total billed, discount given, and pending (outstanding)
// amount — for bills CREATED within the selected date range.
//
// "Pending" here is the current balance on those bills (as of now), not
// a snapshot from back when the range ended — e.g. a bill raised in the
// selected range that's since been fully paid off will show 0 pending,
// even though it contributed to total billed/discount for that range.
// That distinguishes it from Client Outstanding Balances above, which is
// a pure current-state snapshot across ALL bills regardless of date.
router.get("/location-wise", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const rows = await prisma.$queryRaw`
    SELECT
      loc."id" AS location_id,
      COALESCE(loc."name", 'Unspecified (legacy bills)') AS location_name,
      SUM(b."originalAmount")::float AS total_billed,
      SUM(b."discountAmount")::float AS total_discount,
      SUM(b."balance")::float AS total_pending,
      COUNT(b.*)::int AS bills_created
    FROM "bills" b
    LEFT JOIN "locations" loc ON loc."id" = b."locationId"
    WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to}
    GROUP BY loc."id", loc."name"
    ORDER BY total_billed DESC;
  `;
  res.json({ locationWise: rows });
});

// GET /api/analytics/category-wise?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Bill counts per category (walk-in vs credit, or whatever categories
// admin has set up) for bills CREATED within the selected date range.
//
// This counts BILLS, not clients — category is chosen per bill (confirmed
// decision), so the same client could have bills under different
// categories. "How many walk-in vs credit bills" is the well-defined
// question here; "how many walk-in vs credit clients" isn't, since a
// client isn't fixed to one category.
router.get("/category-wise", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const rows = await prisma.$queryRaw`
    SELECT
      cat."id" AS category_id,
      COALESCE(cat."name", 'Unspecified (legacy bills)') AS category_name,
      cat."type" AS category_type,
      COUNT(b.*)::int AS bill_count,
      SUM(b."originalAmount")::float AS total_billed
    FROM "bills" b
    LEFT JOIN "categories" cat ON cat."id" = b."categoryId"
    WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to}
    GROUP BY cat."id", cat."name", cat."type"
    ORDER BY bill_count DESC;
  `;
  res.json({ categoryWise: rows });
});

// GET /api/analytics/company-outstanding
// Outstanding (unpaid) balance per company — the "balance per
// credit-client" view. Like client-outstanding, this is a current-state
// snapshot across ALL of a company's bills regardless of when they were
// created, not scoped to the date range picker.
router.get("/company-outstanding", async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT
      co."id" AS company_id,
      co."name" AS company_name,
      SUM(b."balance")::float AS outstanding_balance,
      COUNT(b.*) FILTER (WHERE b."status" = 'pending')::int AS pending_bill_count
    FROM "companies" co
    JOIN "bills" b ON b."companyId" = co."id"
    GROUP BY co."id", co."name"
    HAVING SUM(b."balance") > 0
    ORDER BY outstanding_balance DESC;
  `;
  res.json({ companyOutstanding: rows });
});

// GET /api/analytics/client-outstanding
// Outstanding (unpaid) balance per client. This is a current-state
// snapshot, not a time series, so it intentionally ignores date range.
router.get("/client-outstanding", async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT
      c."id" AS client_id,
      c."name" AS client_name,
      SUM(b."balance")::float AS outstanding_balance,
      COUNT(b.*) FILTER (WHERE b."status" = 'pending')::int AS pending_bill_count
    FROM "clients" c
    JOIN "bills" b ON b."clientId" = c."id"
    GROUP BY c."id", c."name"
    HAVING SUM(b."balance") > 0
    ORDER BY outstanding_balance DESC;
  `;
  res.json({ clientOutstanding: rows });
});

// GET /api/analytics/client-daily/:clientId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Per-client, per-day collection summary. Same IST day-bucketing approach
// as the day-wise endpoint above — see the comment there.
router.get("/client-daily/:clientId", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const rows = await prisma.$queryRaw`
    SELECT
      DATE(t."createdAt" AT TIME ZONE 'Asia/Kolkata') AS day,
      SUM(t."amountCollected")::float AS total_collected,
      COUNT(t.*)::int AS transaction_count
    FROM "transactions" t
    WHERE t."isDeleted" = false AND t."clientId" = ${req.params.clientId}
      AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
    GROUP BY DATE(t."createdAt" AT TIME ZONE 'Asia/Kolkata')
    ORDER BY day DESC;
  `;
  res.json({ clientDaily: rows });
});

// GET /api/analytics/client-ledger/:clientId
// Full bill-by-bill ledger for one client, each with its transactions.
// Not date-filtered — this is meant to show the complete picture for the
// selected client regardless of the day-wise/operator-wise date range.
router.get("/client-ledger/:clientId", async (req, res) => {
  const bills = await prisma.bill.findMany({
    where: { clientId: req.params.clientId },
    include: {
      transactions: {
        where: { isDeleted: false },
        include: { operator: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ledger: bills });
});

module.exports = router;
