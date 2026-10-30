const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole, RECEPTION } = require("../middleware/auth");
const { route, transaction } = require("../utils/route");
const { HOME_VISIT_CODE } = require("../services/billing");
const { CATALOG_DETAIL, proposeChanges } = require("../services/catalog");

const router = express.Router();

// GET /api/catalog — the active catalog (~150 items, loaded once and
// searched in the browser): tests with their draws and machine steps,
// profiles with their tests. The system home-visit item is left out.
router.get("/", requireAuth, requireRole(...RECEPTION, "accountant"), route("Could not load the catalog.", async (req, res) => {
  const items = await prisma.catalogItem.findMany({
    where: { status: "active", code: { not: HOME_VISIT_CODE } },
    include: CATALOG_DETAIL,
    orderBy: { code: "asc" },
  });
  res.json({ items });
}));

// GET /api/catalog/popular — the quick tiles on the quote and bill forms:
// the 18 items billed most across the lab in the last 90 days (cancelled
// lines don't count), shown in code order so a tile only moves when an item
// enters or leaves the set. Until 18 items have been billed, the rest of
// the catalog fills the grid, in code order.
const TILES = 18;
const POPULAR_DAYS = 90;
router.get("/popular", requireAuth, requireRole(...RECEPTION), route("Could not load the most used items.", async (req, res) => {
  const since = new Date(Date.now() - POPULAR_DAYS * 86400_000);
  const used = await prisma.$queryRaw`
    SELECT c."id" FROM "bill_items" i
    JOIN "bills" b ON b."id" = i."billId"
    JOIN "catalog_items" c ON c."id" = i."catalogItemId"
    WHERE i."status" = 'active' AND b."createdAt" >= ${since} AND c."status" = 'active' AND c."code" != ${HOME_VISIT_CODE}
    GROUP BY c."id", c."code" ORDER BY COUNT(*) DESC, c."code" LIMIT ${TILES}`;
  const ids = used.map((r) => r.id);
  const fill = ids.length < TILES
    ? await prisma.catalogItem.findMany({
        where: { status: "active", code: { not: HOME_VISIT_CODE }, id: { notIn: ids } },
        select: { id: true },
        orderBy: { code: "asc" },
        take: TILES - ids.length,
      })
    : [];
  const items = await prisma.catalogItem.findMany({
    where: { id: { in: [...ids, ...fill.map((f) => f.id)] } },
    select: { id: true, code: true, name: true, kind: true },
    orderBy: { code: "asc" },
  });
  res.json({ items, days: POPULAR_DAYS });
}));

// POST /api/catalog/changes — propose changes, one or a whole grid batch.
// Body: { changes: [{ action: "create" | "update" | "retire", catalogItemId?, values? }] }
// values (create/update, the full row): { code, name, kind, price, department?,
//   sampleType?, container?, instructions?, draws?: [label], machineSteps?:
//   [{ sequence, machineTypeId }], components?: [testId] }
// Nothing is recorded unless every row is valid (400 lists the row errors).
// They wait for the lead's approval; the lead's own apply at once.
router.post("/changes", requireAuth, requireRole(...RECEPTION), route("Could not submit the changes.", async (req, res) => {
  const approvals = await transaction((tx) => proposeChanges(tx, req.body.changes, req.session.user));
  res.status(201).json({ approvals });
}));

module.exports = router;
