// I1–I7, I9, G6: analytics tables, run identically for admin (Analytics tab)
// and accountant (whole page).
//
// Isolation: every test builds its own data on its own backdated day, and the
// admin/accountant variants use different years, so date-range filtering
// shows only that test's data even with parallel workers.
const { test, expect } = require("../../fixtures");
const { AdminPage } = require("../../pages/admin");
const { AnalyticsSection } = require("../../pages/analytics");
const { createUser, db } = require("../../helpers/db");
const { uid, inr, istDate, displayDate } = require("../../helpers/data");

const VARIANTS = [
  { role: "admin", year: 2018 },
  { role: "accountant", year: 2017 },
];

async function openAnalytics(loginAs, role) {
  const viewer = await createUser(role);
  const page = await loginAs(viewer);
  if (role === "admin") {
    const admin = new AdminPage(page);
    await admin.openTab("analytics");
    return admin.analytics;
  }
  return new AnalyticsSection(page);
}

// A legacy bill (no creator / location / category), as left over from
// before those columns existed.
async function legacyBill({ date, amount, balance = amount }) {
  const client = await db().client.create({ data: { name: uid("Legacy") } });
  return db().bill.create({
    data: {
      billNumber: `L${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      clientId: client.id,
      originalAmount: amount,
      netAmount: amount,
      balance,
      status: balance > 0 ? "pending" : "fully_paid",
      createdAt: new Date(`${date}T12:00:00+05:30`),
    },
  });
}

for (const { role, year } of VARIANTS) {
  // Shifted per --repeat-each run so repeated runs never share a day.
  const d = (mmdd) => `${year - 20 * test.info().repeatEachIndex}-${mmdd}`;

  test.describe(`Analytics as ${role}`, () => {
    test("I1/I2: defaults to today; Apply and Clear update the range label", async ({ loginAs }) => {
      const a = await openAnalytics(loginAs, role);
      const today = istDate();
      await expect(a.startDate).toHaveValue(today);
      await expect(a.endDate).toHaveValue(today);
      await expect(a.rangeLabel).toHaveText(`Showing: ${today} only`);

      await a.setRange(d("01-01"), d("01-31"));
      await expect(a.rangeLabel).toHaveText(`Showing: ${d("01-01")} to ${d("01-31")}`);

      await a.clearRange();
      await expect(a.startDate).toHaveValue("");
      await expect(a.rangeLabel).toHaveText("Showing: all time");

      await a.startDate.fill(d("02-01"));
      await a.apply.click();
      await expect(a.rangeLabel).toHaveText(`Showing: from ${d("02-01")} onward`);
      await a.startDate.fill("");
      await a.endDate.fill(d("02-01"));
      await a.apply.click();
      await expect(a.rangeLabel).toHaveText(`Showing: up to ${d("02-01")}`);
    });

    test("I3: day-wise totals and per-mode breakdown for a day", async ({ api, loginAs }) => {
      const day = d("02-10");
      const op = await api(await createUser("operator"));
      await op.createBill({ billDate: day, originalAmount: 1000, initialAmountCollected: 300, initialMode: "cash" });
      await op.createBill({ billDate: day, originalAmount: 1000, initialAmountCollected: 200, initialMode: "upi" });
      await op.createBill({ billDate: day, originalAmount: 1000, initialAmountCollected: 100, initialMode: "credit_card" });
      await op.createBill({ billDate: day, originalAmount: 1000 }); // no payment

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day);
      await expect.poll(() => a.rows("dayWise")).toEqual([
        [displayDate(day), inr(600), "3", `1 (${inr(300)})`, `1 (${inr(100)})`, `1 (${inr(200)})`, "—"],
      ]);
    });

    test("I3b: days are bucketed in IST (00:00–23:59:59 IST), not UTC", async ({ api, loginAs }) => {
      const day = d("03-15");
      const op = await createUser("operator");
      const bill = await (await api(op)).createBill({ billDate: day, originalAmount: 1000 });
      const insertTx = (iso, amount) =>
        db().transaction.create({
          data: {
            billId: bill.id, clientId: bill.client.id, amountCollected: amount, mode: "cash",
            operatorId: op.id, createdById: op.id, createdAt: new Date(iso),
          },
        });
      const prev = d("03-14");
      await insertTx(`${prev}T18:29:59Z`, 1); // 23:59:59 IST on the 14th
      await insertTx(`${prev}T18:30:00Z`, 10); // 00:00:00 IST on the 15th
      await insertTx(`${day}T18:29:59Z`, 100); // 23:59:59 IST on the 15th

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day);
      await expect.poll(async () => (await a.rows("dayWise")).map((r) => r.slice(0, 3))).toEqual([[displayDate(day), inr(110), "2"]]);
      await a.setRange(prev, day);
      await expect.poll(async () => (await a.rows("dayWise")).map((r) => r.slice(0, 3))).toEqual([
        [displayDate(day), inr(110), "2"],
        [displayDate(prev), inr(1), "1"],
      ]);
    });

    test("G6/I3c: a refunded bill leaves collections and shows under Bills Refunded on its refund day", async ({ api, loginAs }) => {
      const billDay = d("04-05");
      const refundDay = d("04-07");
      const op = await api(await createUser("operator"));
      await op.createBill({ billDate: billDay, originalAmount: 500, initialAmountCollected: 500 });
      const refunded = await op.createBill({ billDate: billDay, originalAmount: 300, initialAmountCollected: 120 });
      await op.refund(refunded.id);
      await db().bill.update({ where: { id: refunded.id }, data: { refundedAt: new Date(`${refundDay}T11:00:00+05:30`) } });

      const a = await openAnalytics(loginAs, role);
      await a.setRange(billDay, refundDay);
      await expect.poll(() => a.rows("dayWise")).toEqual([
        [displayDate(refundDay), inr(0), "0", `0 (${inr(0)})`, `0 (${inr(0)})`, `0 (${inr(0)})`, `1 (${inr(120)})`],
        [displayDate(billDay), inr(500), "1", `1 (${inr(500)})`, `0 (${inr(0)})`, `0 (${inr(0)})`, "—"],
      ]);
      // Refunded bills are excluded from every billed/outstanding aggregate too.
      const opRows = await a.rows("operatorWise");
      expect(opRows).toHaveLength(1);
      expect(opRows[0].slice(1)).toEqual([inr(500), inr(0), inr(500), inr(0), "1", "1"]);
    });

    test("I4: operator-wise splits billed (bill owner) from collected (who took the payment)", async ({ api, adminApi, loginAs }) => {
      const day = d("05-20");
      const opA = await createUser("operator");
      const opB = await createUser("operator");
      const apiA = await api(opA);
      const apiB = await api(opB);
      await apiA.createBill({ billDate: day, originalAmount: 1000, discountAmount: 100, initialAmountCollected: 300 });
      await apiB.createBill({ billDate: day, originalAmount: 500 });
      const moved = await apiA.createBill({ billDate: day, originalAmount: 400, initialAmountCollected: 200 });
      await adminApi.reassign(moved.id, opB.id);
      await legacyBill({ date: day, amount: 70 });

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day);
      // [Total Billed, Discount, Collected, Outstanding, Bills Created, Payments Taken]
      await expect.poll(async () => (await a.rowCells("operatorWise", opA.name)).slice(1)).toEqual([inr(1000), inr(100), inr(500), inr(600), "1", "2"]);
      await expect.poll(async () => (await a.rowCells("operatorWise", opB.name)).slice(1)).toEqual([inr(900), inr(0), inr(0), inr(700), "2", "0"]);
      expect((await a.rowCells("operatorWise", "Unattributed (legacy bills)")).slice(1)).toEqual([
        inr(70), inr(0), inr(0), inr(70), "1", "0",
      ]);
      await expect.poll(() => a.rows("operatorWise")).toHaveLength(3);
    });

    test("I5: location-wise and category-wise group bills created in range", async ({ api, adminApi, loginAs }) => {
      const day = d("06-11");
      const loc = await adminApi.addLocation({ locationCode: "50" });
      const std = await adminApi.addCategory();
      const { category: credit } = await adminApi.addCreditCategory();
      const op = await api(await createUser("operator"));
      await op.createBill({ billDate: day, locationId: loc.id, categoryId: std.id, originalAmount: 1000, discountAmount: 100, initialAmountCollected: 300 });
      await op.createBill({ billDate: day, locationId: loc.id, categoryId: credit.id, originalAmount: 500 });
      const refunded = await op.createBill({ billDate: day, locationId: loc.id, categoryId: std.id, originalAmount: 200, initialAmountCollected: 50 });
      await op.refund(refunded.id);
      await legacyBill({ date: day, amount: 30 });

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day);
      await expect.poll(() => a.rows("locationWise")).toEqual([
        [loc.name, inr(1500), inr(100), inr(1100), "2"],
        ["Unspecified (legacy bills)", inr(30), inr(0), inr(30), "1"],
      ]);
      const categoryRows = await a.rows("categoryWise");
      expect(categoryRows).toHaveLength(3);
      await expect.poll(() => a.rowCells("categoryWise", std.name)).toEqual([std.name, "standard", "1", inr(1000), inr(100), inr(600)]);
      await expect.poll(() => a.rowCells("categoryWise", credit.name)).toEqual([credit.name, "credit", "1", inr(500), inr(0), inr(500)]);
      expect(await a.rowCells("categoryWise", "Unspecified (legacy bills)")).toEqual([
        "Unspecified (legacy bills)", "—", "1", inr(30), inr(0), inr(30),
      ]);
    });

    test("I6: client outstanding ignores the date range and lists only clients who owe money", async ({ adminApi, loginAs }) => {
      const owes = uid("Owes");
      const settled = uid("Settled");
      const old = await adminApi.createBill({ clientName: owes, billDate: "2015-01-01", originalAmount: 300 });
      await adminApi.createBill({ clientId: old.client.id, originalAmount: 500, initialAmountCollected: 300 });
      await adminApi.createBill({ clientId: old.client.id, originalAmount: 100, initialAmountCollected: 100 });
      const refunded = await adminApi.createBill({ clientId: old.client.id, originalAmount: 900, initialAmountCollected: 1 });
      await adminApi.refund(refunded.id);
      await adminApi.createBill({ clientName: settled, originalAmount: 100, initialAmountCollected: 100 });

      const a = await openAnalytics(loginAs, role);
      await a.setRange(d("07-01")); // a day with none of this data
      await expect.poll(() => a.rowCells("clientOutstanding", owes)).toEqual([owes, inr(500), "2"]);
      await expect(a.row("clientOutstanding", settled)).toHaveCount(0);
    });

    test("I7: per-client detail — daily summary follows the range; ledger shows full history", async ({ api, loginAs }) => {
      const day1 = d("08-01");
      const day2 = d("08-02");
      const opUser = await createUser("operator");
      const op = await api(opUser);
      const name = uid("Detail");
      const b1 = await op.createBill({ clientName: name, billDate: day1, originalAmount: 500, initialAmountCollected: 100, initialMode: "upi" });
      const b2 = await op.createBill({ clientId: b1.client.id, billDate: day2, originalAmount: 200, initialAmountCollected: 50 });
      await op.pay(b2.id, 100, { discountAmount: 50 });
      const b3 = await op.createBill({ clientId: b1.client.id, billDate: day1, originalAmount: 80, initialAmountCollected: 30 });
      await op.refund(b3.id);
      await op.createBill({ clientId: b1.client.id, billDate: "2016-01-01", originalAmount: 10 });

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day1, day2);
      await a.selectLedgerClient(name);
      await expect.poll(() => a.rows("clientDaily")).toEqual([
        [displayDate(day2), inr(50), "1"],
        [displayDate(day1), inr(100), "1"],
      ]);

      const ledger = await a.rows("clientLedger");
      expect(ledger).toHaveLength(4); // full history, not date-filtered, incl. refunded
      const byNumber = Object.fromEntries(ledger.map((r) => [r[0], r]));
      expect(byNumber[b1.billNumber]).toEqual([b1.billNumber, inr(500), inr(400), "Pending", `${inr(100)} (upi, ${opUser.name})`]);
      expect(byNumber[b2.billNumber]).toEqual([
        b2.billNumber, inr(150), inr(0), "Fully Paid",
        `${inr(50)} (cash, ${opUser.name}); ${inr(100)} + ${inr(50)} discount (cash, ${opUser.name})`,
      ]);
      expect(byNumber[b3.billNumber][3]).toBe("Refunded");

      // Changing the range re-queries the client's daily summary.
      await a.setRange(day1);
      await expect.poll(() => a.rows("clientDaily")).toEqual([[displayDate(day1), inr(100), "1"]]);
    });

    test("I9: reconciliation — every table agrees on the same day's totals", async ({ api, adminApi, loginAs }) => {
      const day = d("09-09");
      const loc1 = await adminApi.addLocation({ locationCode: "51" });
      const loc2 = await adminApi.addLocation({ locationCode: "52" });
      const cat = await adminApi.addCategory();
      const { category: credit, company } = await adminApi.addCreditCategory();
      const ops = await Promise.all([createUser("operator"), createUser("operator")]);
      const [s1, s2] = await Promise.all(ops.map((o) => api(o)));

      const plan = [
        [s1, loc1, cat, 1200, 200, 500, "cash"],
        [s1, loc2, credit, 800, 0, 0, "cash"],
        [s2, loc1, credit, 650, 50, 600, "upi"],
        [s2, loc2, cat, 999.5, 0.5, 250.25, "credit_card"],
        [s2, loc2, cat, 400, 0, 400, "cash"],
      ];
      const created = [];
      for (const [s, loc, c, original, discount, initial, mode] of plan) {
        created.push(await s.createBill({
          billDate: day, locationId: loc.id, categoryId: c.id, originalAmount: original,
          discountAmount: discount, initialAmountCollected: initial || undefined, initialMode: mode,
        }));
      }
      await s1.refund(created[4].id);
      await adminApi.settle(company.id, [created[1].id]); // today, outside range: affects balances only

      const a = await openAnalytics(loginAs, role);
      await a.setRange(day);
      const num = (s) => Number(s.replace(/,/g, "").replace(/\s*\(.*$/, ""));
      const sum = (rows, col) => rows.reduce((t, r) => t + num(r[col]), 0);

      await expect.poll(async () => (await a.rows("dayWise")).map((r) => r[0])).toEqual([displayDate(day)]);
      const dayRows = await a.rows("dayWise");
      const opRows = await a.rows("operatorWise");
      const locRows = await a.rows("locationWise");
      const catRows = await a.rows("categoryWise");

      const expectedCollected = 500 + 600 + 250.25;
      const expectedBilled = 1200 + 800 + 650 + 999.5;
      const expectedOutstanding = 500 + 0 + 0 + 748.75; // credit bill settled
      expect(sum(dayRows, 1)).toBeCloseTo(expectedCollected, 2);
      expect(sum(opRows, 3)).toBeCloseTo(expectedCollected, 2);
      for (const [rows, billedCol, outCol] of [[opRows, 1, 4], [locRows, 1, 3], [catRows, 3, 5]]) {
        expect(sum(rows, billedCol)).toBeCloseTo(expectedBilled, 2);
        expect(sum(rows, outCol)).toBeCloseTo(expectedOutstanding, 2);
      }
      expect(sum(locRows, 4)).toBe(4);
      expect(sum(catRows, 2)).toBe(4);
    });
  });
}

test.describe("Accountant is read-only (J1)", () => {
  test("J1: no billing, tabs, or management controls; read-only note shown", async ({ loginAs, users }) => {
    const page = await loginAs(users.acct);
    for (const sel of [
      "#bill-form", "#transaction-form", "#settlement-form", ".tabs", "#promote-form", "#reassign-form",
      "#add-location-form", "#add-category-form", "#create-user-form", "#bills-table", ".refund-btn",
    ]) {
      await expect(page.locator(sel), sel).toHaveCount(0);
    }
    await expect(page.getByText("Read-only view")).toBeVisible();
    for (const id of ["#day-wise-table", "#operator-wise-table", "#location-wise-table", "#category-wise-table", "#client-outstanding-table"]) {
      await expect(page.locator(id)).toBeVisible();
    }
  });
});
