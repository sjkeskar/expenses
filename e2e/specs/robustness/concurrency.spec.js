// Several users acting on the same records at the same moment (6+
// technicians work concurrently). Each scenario runs on several bills at
// once so a race has a real chance to show up.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");

const TRIALS = 8;

async function sessions(role, n) {
  return Promise.all(Array.from({ length: n }, () => createUser(role).then((u) => ApiClient.as(u))));
}

async function money(billId) {
  const bill = await db().bill.findUnique({ where: { id: billId }, include: { transactions: { where: { isDeleted: false } }, refunds: true } });
  const sum = (rows, field) => rows.reduce((t, r) => t + Math.round(Number(r[field]) * 100), 0);
  return { bill, collected: sum(bill.transactions, "amountCollected") - sum(bill.refunds, "amount") };
}

test.describe("Concurrent writes", () => {
  let techs;
  test.beforeEach(async () => {
    techs = await sessions("technician", 2);
  });
  test.afterEach(async () => {
    await Promise.all(techs.map((s) => s.dispose()));
  });

  test("two simultaneous payments never collect more than the bill's net amount", async ({ leadApi }) => {
    const bills = await Promise.all(Array.from({ length: TRIALS }, () => leadApi.createBill()));
    await Promise.all(bills.flatMap((b) => techs.map((s) => s.raw("POST", "/transactions", { billId: b.id, amountCollected: 200, mode: "cash" }))));
    for (const b of bills) {
      const { bill, collected } = await money(b.id);
      expect(collected, bill.billNumber).toBeLessThanOrEqual(30000);
      expect(Math.round(Number(bill.balance) * 100), bill.billNumber).toBe(30000 - collected);
    }
  });

  test("a cancellation racing a payment leaves consistent totals and refunds", async ({ leadApi }) => {
    const bills = await Promise.all(
      Array.from({ length: TRIALS }, () => leadApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 250, mode: "cash" } }))
    );
    await Promise.all(
      bills.flatMap((b) => [
        techs[0].raw("PATCH", `/bills/${b.id}/cancel-items`, { itemIds: [b.items.find((i) => i.code === "CBC").id], reason: "race", refundMode: "cash" }),
        techs[1].raw("POST", "/transactions", { billId: b.id, amountCollected: 150, mode: "cash" }),
      ])
    );
    for (const b of bills) {
      const { bill, collected } = await money(b.id);
      expect(collected, bill.billNumber).toBeLessThanOrEqual(Math.round(Number(bill.netAmount) * 100));
      expect(Math.round(Number(bill.balance) * 100), bill.billNumber).toBe(Math.round(Number(bill.netAmount) * 100) - collected);
    }
  });

  test("two simultaneous cancellations of the same item cancel it once", async ({ leadApi }) => {
    const bills = await Promise.all(Array.from({ length: TRIALS }, () => leadApi.createBill({ items: ["CBC", "GLUF"] })));
    const results = await Promise.all(
      bills.flatMap((b) => techs.map((s) => s.raw("PATCH", `/bills/${b.id}/cancel-items`, { itemIds: [b.items[0].id], reason: "race" })))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(TRIALS);
    for (const b of bills) expect(await db().cancellation.count({ where: { billId: b.id } })).toBe(1);
  });

  test("a panel settlement racing a payment can't overpay a bill", async ({ leadApi }) => {
    const panel = await leadApi.addPanel();
    const bills = await Promise.all(Array.from({ length: TRIALS }, () => leadApi.createBill({ payerType: "panel", panelId: panel.id })));
    await Promise.all([
      techs[0].raw("POST", `/panels/${panel.id}/settle`, { billIds: bills.map((b) => b.id), mode: "cash" }),
      ...bills.map((b) => techs[1].raw("POST", "/transactions", { billId: b.id, amountCollected: 100, mode: "cash" })),
    ]);
    for (const b of bills) expect((await money(b.id)).collected).toBeLessThanOrEqual(30000);
  });

  test("two simultaneous conversions of one quotation make one bill", async () => {
    const quotes = await Promise.all(Array.from({ length: TRIALS }, () => techs[0].createQuote()));
    const patients = await Promise.all(techs.map((s) => s.registerPatient()));
    const results = await Promise.all(
      quotes.flatMap((q) => techs.map((s, i) => s.raw("POST", "/bills", { quotationId: q.id, patientId: patients[i].id })))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(TRIALS);
    expect(results.filter((r) => r.status === 409)).toHaveLength(TRIALS);
    for (const q of quotes) expect(await db().bill.count({ where: { quotationId: q.id } })).toBe(1);
  });

  test("two pathologists deciding the same request: one decision wins", async ({ api }) => {
    const [pa, pb] = await sessions("pathologist", 2);
    try {
      const bills = await Promise.all(Array.from({ length: TRIALS }, () => techs[0].createBill({ discountAmount: 10 })));
      const approvals = await Promise.all(bills.map((b) => techs[0].approvalFor({ billId: b.id, subjectType: "bill_discount" })));
      const results = await Promise.all(approvals.flatMap((a) => [pa.raw("POST", `/approvals/${a.id}/approve`, {}), pb.raw("POST", `/approvals/${a.id}/reject`, {})]));
      expect(results.filter((r) => r.status === 200)).toHaveLength(TRIALS);
      expect(results.filter((r) => r.status === 409)).toHaveLength(TRIALS);
    } finally {
      await Promise.all([pa.dispose(), pb.dispose()]);
    }
  });

  test("two reassignments of the same bill keep history and current owner in sync", async ({ leadApi }) => {
    const [owner, t1, t2] = await Promise.all([createUser("technician"), createUser("technician"), createUser("technician")]);
    const ownerApi = await ApiClient.as(owner);
    const second = await ApiClient.as({ name: "e2e-lead", password: "Test@123" });
    try {
      const bills = await Promise.all(Array.from({ length: TRIALS }, () => ownerApi.createBill()));
      await Promise.all(
        bills.flatMap((b) => [
          leadApi.raw("PATCH", `/bills/${b.id}/reassign-technician`, { technicianId: t1.id }),
          second.raw("PATCH", `/bills/${b.id}/reassign-technician`, { technicianId: t2.id }),
        ])
      );
      for (const b of bills) {
        const bill = await db().bill.findUnique({ where: { id: b.id }, include: { reassignments: { orderBy: { reassignedAt: "asc" } } } });
        expect(bill.reassignments.at(-1).toTechnicianId, bill.billNumber).toBe(bill.createdById);
        bill.reassignments.forEach((r, i) => {
          expect(r.fromTechnicianId).toBe(i === 0 ? owner.id : bill.reassignments[i - 1].toTechnicianId);
        });
      }
    } finally {
      await Promise.all([ownerApi.dispose(), second.dispose()]);
    }
  });
});
