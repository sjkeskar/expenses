// The Day Sheet (pivot.md §6.7), document verification (§6.9) and the
// Step 1 analytics. Each test works in a far-off IST day of its own, so
// totals are exact even with parallel workers.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { istDate, uid } = require("../../helpers/data");

// A distinct past day per test, so its movements are the only ones there.
const dayFor = (n) => istDate(new Date(Date.UTC(2015, 0, 1) + n * 86400000));

test.describe("Day Sheet", () => {
  test("totals by mode come from the money taken that day, on any bill, minus refunds", async ({ leadApi }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      const day = dayFor(Math.floor(Math.random() * 3000));
      // An older bill by someone else, paid today by this technician.
      const old = await leadApi.createBill({ billDate: "2014-06-01" });
      const ownBill = await client.createBill({ items: ["CBC", "GLUF"], billDate: day, initialPayment: { amount: 400, mode: "cash" } });
      await client.cancel(ownBill, ["GLUF"], { refundMode: "cash" });
      const paid = await client.pay(old.id, 120, { mode: "upi" });
      // Pin every movement to a time on the test's own day.
      const at = (hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
      await db().transaction.updateMany({ where: { billId: ownBill.id }, data: { createdAt: at("09:00") } });
      await db().refund.updateMany({ where: { billId: ownBill.id }, data: { createdAt: at("10:00") } });
      await db().transaction.updateMany({ where: { id: paid.id }, data: { createdAt: at("11:00") } });

      const sheet = await client.call("GET", `/daysheet?date=${day}`);
      expect(sheet.totals).toEqual({ cash: "300.00", credit_card: "0.00", upi: "120.00", total: "420.00" });
      expect(sheet.money.map((m) => [m.kind, m.amount])).toEqual([["payment", "400.00"], ["refund", "-100.00"], ["payment", "120.00"]]);
      expect(sheet.bills.map((b) => b.id)).toEqual([ownBill.id]);
    } finally {
      await client.dispose();
    }
  });

  test("only the lead and the accountant can open someone else's", async ({ techApi, api, users, leadApi }) => {
    const other = await db().user.findUnique({ where: { name: users.tech2.name } });
    expect((await techApi.raw("GET", `/daysheet?userId=${other.id}`)).status).toBe(403);
    expect((await leadApi.raw("GET", `/daysheet?userId=${other.id}`)).status).toBe(200);
    expect((await (await api(users.acct)).raw("GET", `/daysheet?userId=${other.id}`)).status).toBe(200);
    // Their picker lists everyone who takes money, and no one else.
    const { users: list } = await leadApi.call("GET", "/daysheet/users");
    expect(list.map((u) => u.name)).toEqual(expect.arrayContaining([users.tech1.name, users.path1.name, users.lead.name]));
    expect(list.map((u) => u.name)).not.toContain(users.acct.name);
  });
});

test.describe("Verify document", () => {
  test("a bill's code finds it; corrections after issue are flagged; unknown codes don't", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill();
    const { document } = await techApi.call("GET", `/verify/${bill.verificationCode.toLowerCase()}`);
    expect(document).toMatchObject({ type: "bill", number: bill.billNumber, patientCorrectedAt: null });

    await (await api(users.path1)).call("POST", `/patients/${bill.patient.id}/corrections`, { name: `${bill.patient.name} R` });
    expect((await techApi.call("GET", `/verify/${bill.verificationCode}`)).document.patientCorrectedAt).not.toBeNull();
    expect((await techApi.raw("GET", "/verify/ZZZZZZZZZZZZ")).status).toBe(404);
  });
});

test.describe("Analytics", () => {
  test("day-wise and technician-wise net payments against refunds", async ({ api, users }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      const day = dayFor(4000 + Math.floor(Math.random() * 3000));
      const bill = await client.createBill({ items: ["CBC", "GLUF"], billDate: day, initialPayment: { amount: 400, mode: "credit_card" } });
      await client.cancel(bill, ["GLUF"], { refundMode: "credit_card" });
      await db().refund.updateMany({ where: { billId: bill.id }, data: { createdAt: new Date(`${day}T11:00:00+05:30`) } });

      const acct = await api(users.acct);
      const { dayWise } = await acct.call("GET", `/analytics/day-wise?startDate=${day}&endDate=${day}`);
      expect(dayWise).toEqual([
        expect.objectContaining({ net_collected: 300, payment_count: 1, refund_count: 1, refund_total: 100, credit_card: 300 }),
      ]);
      const { technicianWise } = await acct.call("GET", `/analytics/technician-wise?startDate=${day}&endDate=${day}`);
      expect(technicianWise).toEqual([
        expect.objectContaining({ user_id: tech.id, net_collected: 300, total_billed: 300, bills_created: 1 }),
      ]);
    } finally {
      await client.dispose();
    }
  });

  test("referral-, payer- and test-wise summaries", async ({ api, users, leadApi }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      const day = dayFor(-1000 - Math.floor(Math.random() * 3000));
      const doctor = (await client.call("POST", "/doctors", { name: uid("Dr") })).doctor;
      const panel = await leadApi.addPanel();
      const bills = [
        await client.createBill({ items: ["CBC", "GLUF"], referralType: "doctor", referringDoctorId: doctor.id, billDate: day }),
        await client.createBill({ items: ["CBC"], payerType: "panel", panelId: panel.id, billDate: day, discountAmount: 50 }),
        await client.createBill({ items: ["LIPID"], billDate: day }),
      ];
      await client.cancel(bills[0], ["GLUF"]);

      const acct = await api(users.acct);
      const range = `startDate=${day}&endDate=${day}`;
      const { referralWise } = await acct.call("GET", `/analytics/referral-wise?${range}`);
      expect(referralWise).toEqual([
        expect.objectContaining({ referral_type: "walk_in", doctor_id: null, bills: 2, total_billed: 550, total_discount: 50, net_billed: 500 }),
        expect.objectContaining({ referral_type: "doctor", doctor_id: doctor.id, bills: 1, net_billed: 300 }),
      ]);
      const { payerWise } = await acct.call("GET", `/analytics/payer-wise?${range}`);
      expect(payerWise).toEqual([
        expect.objectContaining({ payer_type: "self", panel_id: null, bills: 2, net_billed: 550, total_pending: 550 }),
        expect.objectContaining({ payer_type: "panel", panel_id: panel.id, panel_name: panel.name, bills: 1, net_billed: 250 }),
      ]);
      const { testWise } = await acct.call("GET", `/analytics/test-wise?${range}`);
      expect(testWise.map((t) => [t.code, t.billed_count, t.billed_amount, t.cancelled_count])).toEqual([
        ["CBC", 2, 600, 0],
        ["LIPID", 1, 250, 0],
        ["GLUF", 0, 0, 1],
      ]);
    } finally {
      await client.dispose();
    }
  });

  test("the period tally equals the sum of that period's day sheets", async ({ api, users, leadApi }) => {
    const [tech, path] = [await createUser("technician"), await createUser("pathologist")];
    const [techClient, pathClient] = [await ApiClient.as(tech), await ApiClient.as(path)];
    try {
      const first = dayFor(-5000 - Math.floor(Math.random() * 3000));
      const second = istDate(new Date(new Date(`${first}T12:00:00+05:30`).getTime() + 86400000));
      const panel = await leadApi.addPanel();
      const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

      const a = await techClient.createBill({ items: ["CBC", "GLUF"], billDate: first, discountAmount: 20, initialPayment: { amount: 380, mode: "cash" } });
      await techClient.cancel(a, ["GLUF"], { refundMode: "upi", discountAmount: 20 });
      const b = await pathClient.createBill({ items: ["CHOL"], billDate: second, discountAmount: 10, initialPayment: { amount: 40, mode: "credit_card" } });
      const c = await techClient.createBill({ items: ["TG"], payerType: "panel", panelId: panel.id, billDate: first });
      const d = await techClient.createBill({ items: ["CBC"], payerType: "panel", panelId: panel.id, billDate: first });
      await pathClient.call("POST", `/panels/${panel.id}/settle`, { billIds: [c.id], mode: "upi" });
      // Pin every movement inside the two days.
      await db().transaction.updateMany({ where: { billId: a.id }, data: { createdAt: at(first, "09:00") } });
      await db().refund.updateMany({ where: { billId: a.id }, data: { createdAt: at(first, "10:00") } });
      await db().transaction.updateMany({ where: { billId: b.id }, data: { createdAt: at(second, "09:00") } });
      await db().transaction.updateMany({ where: { billId: c.id }, data: { createdAt: at(second, "15:00") } });

      const acct = await api(users.acct);
      const { tally } = await acct.call("GET", `/analytics/tally?startDate=${first}&endDate=${second}`);
      expect(tally.byMode).toEqual([
        { mode: "cash", payments: 380, settlements: 0, refunds: 0, net: 380 },
        { mode: "credit_card", payments: 40, settlements: 0, refunds: 0, net: 40 },
        { mode: "upi", payments: 0, settlements: 150, refunds: 100, net: 50 },
      ]);
      expect(tally.totals).toEqual({ payments: 420, settlements: 150, refunds: 100, net: 470 });
      // Discounts on bills raised in the period: the pathologist's is self-approved.
      expect(tally.discounts).toEqual({ approved: 10, approved_count: 1, pending: 20, pending_count: 1 });
      expect(tally.panels).toContainEqual(expect.objectContaining({ panel_id: panel.id, pending_bills: 1, outstanding: 300 }));

      // The same figures, from every user's day sheet on both days.
      const sheetTotals = { cash: 0, credit_card: 0, upi: 0 };
      for (const day of [first, second]) {
        for (const user of [tech, path]) {
          const { totals } = await acct.call("GET", `/daysheet?date=${day}&userId=${user.id}`);
          for (const mode of Object.keys(sheetTotals)) sheetTotals[mode] += Number(totals[mode]);
        }
      }
      expect(tally.byMode.map((m) => [m.mode, m.net])).toEqual(Object.entries(sheetTotals));
    } finally {
      await Promise.all([techClient.dispose(), pathClient.dispose()]);
    }
  });

  test("patient outstanding and ledger", async ({ techApi, leadApi }) => {
    const bill = await techApi.createBill({ initialPayment: { amount: 100, mode: "cash" } });
    const { patientOutstanding } = await leadApi.call("GET", "/analytics/patient-outstanding");
    expect(patientOutstanding).toContainEqual(expect.objectContaining({ patient_id: bill.patient.id, outstanding_balance: 200 }));
    const { ledger } = await leadApi.call("GET", `/analytics/patient-ledger/${bill.patient.id}`);
    expect(ledger.map((b) => b.id)).toEqual([bill.id]);
  });
});
