// Deterministic API responses for visual-regression snapshots. The real
// static pages are served by the app; every /api call is answered from the
// fixed data below, so screenshots never depend on database contents, test
// order, or today's date.
const T = (iso) => new Date(iso).toISOString();

const USERS = {
  operator: { id: "u-op", name: "Ravi Kumar", role: "operator" },
  admin: { id: "u-admin", name: "Meera Shah", role: "admin" },
  developer: { id: "u-dev", name: "Dev Team", role: "developer" },
  accountant: { id: "u-acct", name: "Anil Rao", role: "accountant" },
};

const clients = [
  { id: "c1", name: "Asha Traders", createdAt: T("2026-09-01T05:00:00Z") },
  { id: "c2", name: "Bharat Stores", createdAt: T("2026-09-02T05:00:00Z") },
  { id: "c3", name: "Chennai Mills", createdAt: T("2026-09-03T05:00:00Z") },
];
const locations = [
  { id: "l1", name: "Main Store", locationCode: "01", createdAt: T("2026-08-01T05:00:00Z") },
  { id: "l2", name: "Warehouse Road", locationCode: "02", createdAt: T("2026-08-02T05:00:00Z") },
];
const company = { id: "co1", name: "Acme Corp" };
const categories = [
  { id: "cat2", name: "Acme Credit", type: "credit", company, createdAt: T("2026-08-03T05:00:00Z") },
  { id: "cat1", name: "Walk-in", type: "standard", company: null, createdAt: T("2026-08-03T05:00:00Z") },
];

function bills(ownerId) {
  const owner = Object.values(USERS).find((u) => u.id === ownerId);
  const base = { createdBy: { id: owner.id, name: owner.name }, refundedBy: null, refundedAmount: null };
  return [
    { ...base, id: "b1", billNumber: "0126100003", client: clients[0], category: categories[1], company: null, location: locations[0],
      originalAmount: "1500", discountAmount: "100", netAmount: "1400", balance: "400", status: "pending", createdAt: T("2026-10-15T05:10:00Z") },
    { ...base, id: "b2", billNumber: "0126100002", client: clients[1], category: categories[0], company, location: locations[0],
      originalAmount: "2500", discountAmount: "0", netAmount: "2500", balance: "2500", status: "pending", createdAt: T("2026-10-14T09:45:00Z") },
    { ...base, id: "b3", billNumber: "0226100001", client: clients[2], category: categories[1], company: null, location: locations[1],
      originalAmount: "800", discountAmount: "0", netAmount: "800", balance: "0", status: "fully_paid", createdAt: T("2026-10-13T11:00:00Z") },
    { ...base, id: "b4", billNumber: "0126100000", client: clients[0], category: categories[1], company: null, location: locations[0],
      originalAmount: "300", discountAmount: "0", netAmount: "300", balance: "0", status: "refunded", refundedAmount: "120",
      refundedBy: { id: owner.id, name: owner.name }, createdAt: T("2026-10-12T06:20:00Z") },
  ];
}

const allUsers = [
  { ...USERS.developer, isDeleted: false, deletedAt: null, createdAt: T("2026-08-01T04:00:00Z") },
  { ...USERS.admin, isDeleted: false, deletedAt: null, createdAt: T("2026-08-01T04:30:00Z") },
  { ...USERS.operator, isDeleted: false, deletedAt: null, createdAt: T("2026-08-02T04:30:00Z") },
  { id: "u-op2", name: "Sunita Patel", role: "operator", isDeleted: false, deletedAt: null, createdAt: T("2026-08-03T04:30:00Z") },
  { ...USERS.accountant, isDeleted: false, deletedAt: null, createdAt: T("2026-08-04T04:30:00Z") },
  { id: "u-old", name: "Former Staff", role: "operator", isDeleted: true, deletedAt: T("2026-09-30T10:00:00Z"), createdAt: T("2026-08-05T04:30:00Z") },
];

const analytics = {
  "day-wise": {
    dayWise: [
      { day: "2026-10-15", total_collected: 5250, transaction_count: 6, cash_count: 3, cash_total: 2100, credit_card_count: 1,
        credit_card_total: 1500, upi_count: 2, upi_total: 1650, refunded_bill_count: 1, refunded_amount_total: 120 },
      { day: "2026-10-14", total_collected: 3100, transaction_count: 4, cash_count: 2, cash_total: 900, credit_card_count: 0,
        credit_card_total: 0, upi_count: 2, upi_total: 2200, refunded_bill_count: 0, refunded_amount_total: 0 },
    ],
  },
  "operator-wise": {
    operatorWise: [
      { operatorId: "u-op", operatorName: "Ravi Kumar", totalBilled: 9800, totalDiscount: 300, totalCollected: 6200, totalPending: 3300, billsCreated: 7, transactionCount: 8 },
      { operatorId: "u-op2", operatorName: "Sunita Patel", totalBilled: 4100, totalDiscount: 0, totalCollected: 2150, totalPending: 1950, billsCreated: 3, transactionCount: 2 },
    ],
  },
  "location-wise": {
    locationWise: [
      { location_id: "l1", location_name: "Main Store", total_billed: 10400, total_discount: 300, total_pending: 3800, bills_created: 7 },
      { location_id: "l2", location_name: "Warehouse Road", total_billed: 3500, total_discount: 0, total_pending: 1450, bills_created: 3 },
    ],
  },
  "category-wise": {
    categoryWise: [
      { category_id: "cat1", category_name: "Walk-in", category_type: "standard", bill_count: 8, total_billed: 9400, total_discount: 300, total_outstanding: 2750 },
      { category_id: "cat2", category_name: "Acme Credit", category_type: "credit", bill_count: 2, total_billed: 4500, total_discount: 0, total_outstanding: 2500 },
    ],
  },
  "client-outstanding": {
    clientOutstanding: [
      { client_id: "c2", client_name: "Bharat Stores", outstanding_balance: 2500, pending_bill_count: 1 },
      { client_id: "c1", client_name: "Asha Traders", outstanding_balance: 400, pending_bill_count: 1 },
    ],
  },
};

function clientLedger() {
  return {
    ledger: [
      { ...bills("u-op")[0], transactions: [
        { amountCollected: "1000", discountAmount: "0", mode: "upi", operator: { name: "Ravi Kumar" } },
      ] },
      { ...bills("u-op")[3], transactions: [
        { amountCollected: "120", discountAmount: "0", mode: "cash", operator: { name: "Sunita Patel" } },
      ] },
    ],
  };
}

function billDetail(ownerId) {
  return {
    bill: {
      ...bills(ownerId)[1],
      transactions: [],
      reassignments: [
        { reassignedAt: T("2026-10-14T10:00:00Z"), fromOperator: { name: "Sunita Patel" }, toOperator: { name: "Ravi Kumar" }, reassignedBy: { name: "Meera Shah" } },
        { reassignedAt: T("2026-10-15T04:00:00Z"), fromOperator: { name: "Ravi Kumar" }, toOperator: { name: "Meera Shah" }, reassignedBy: { name: "Meera Shah" } },
      ],
    },
  };
}

// Answers every /api request for a page viewed as `role`.
async function mockApi(page, role) {
  const me = USERS[role];
  // External web fonts are blocked so rendering never depends on internet access.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/me") return me ? json({ user: me }) : json({ error: "Not logged in." }, 401);
    if (path === "/auth/login") return json({ error: "Invalid name or password." }, 401);
    if (method !== "GET") return json({});
    if (path === "/clients") return json({ clients });
    if (path === "/locations") return json({ locations });
    if (path === "/categories") return json({ categories });
    if (path === "/companies") return json({ companies: [company] });
    if (path === "/bills") return json({ bills: bills(me.id) });
    if (/^\/bills\/[^/]+$/.test(path)) return json(billDetail(me.id));
    if (path === "/companies/co1/outstanding") {
      const pending = bills(me.id).filter((b) => b.status === "pending");
      return json({ company, totalOutstanding: 2900, pendingBillCount: pending.length, pendingBills: pending });
    }
    if (path === "/users") return json({ users: allUsers });
    if (path === "/users/operators") return json({ operators: allUsers.filter((u) => u.role === "operator" && !u.isDeleted) });
    if (path === "/users/reassign-targets") return json({ targets: allUsers.filter((u) => ["operator", "admin"].includes(u.role) && !u.isDeleted) });
    const a = /^\/analytics\/([a-z-]+)/.exec(path);
    if (a) {
      if (a[1] === "client-daily") return json({ clientDaily: [{ day: "2026-10-15", total_collected: 1000, transaction_count: 1 }] });
      if (a[1] === "client-ledger") return json(clientLedger());
      return json(analytics[a[1]]);
    }
    return json({ error: "Not mocked" }, 404);
  });
}

// Fixed "now" for every visual test: 15 Oct 2026, 12:00 IST.
const FROZEN_NOW = new Date("2026-10-15T06:30:00Z");

module.exports = { mockApi, FROZEN_NOW, USERS };
