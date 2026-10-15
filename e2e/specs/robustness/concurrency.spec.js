// L2–L5: several users acting on the same bill at the same moment (the shop
// runs 6+ operators concurrently). Each scenario is tried on several bills at
// once so a race has a real chance to show up.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");

const TRIALS = 8;

async function sessions(n) {
  const users = await Promise.all(Array.from({ length: n }, () => createUser("operator")));
  return Promise.all(users.map((u) => ApiClient.as(u)));
}

async function liveTotals(billId) {
  const bill = await db().bill.findUnique({ where: { id: billId }, include: { transactions: { where: { isDeleted: false } } } });
  const collected = bill.transactions.reduce((t, x) => t + Number(x.amountCollected) + Number(x.discountAmount), 0);
  return { bill, collected };
}

test.describe("Concurrent writes on one bill", () => {
  let ops;
  test.beforeEach(async () => {
    ops = await sessions(2);
  });
  test.afterEach(async () => {
    await Promise.all(ops.map((s) => s.dispose()));
  });

  test("L2: two simultaneous payments can never collect more than the bill's net amount", async ({ adminApi }) => {
    const bills = await Promise.all(Array.from({ length: TRIALS }, () => adminApi.createBill({ originalAmount: 100 })));
    await Promise.all(bills.flatMap((b) => ops.map((s) => s.raw("POST", "/transactions", { billId: b.id, amountCollected: 60, mode: "cash" }))));

    for (const b of bills) {
      const { bill, collected } = await liveTotals(b.id);
      expect(collected, `bill ${bill.billNumber}`).toBeLessThanOrEqual(100);
      expect(Number(bill.balance), `bill ${bill.billNumber}`).toBe(100 - collected);
    }
  });

  test("L4: a refund racing a payment leaves a consistent bill", async ({ adminApi }) => {
    const bills = await Promise.all(
      Array.from({ length: TRIALS }, () => adminApi.createBill({ originalAmount: 100, initialAmountCollected: 50 }))
    );
    await Promise.all(
      bills.flatMap((b) => [
        ops[0].raw("PATCH", `/bills/${b.id}/refund`),
        ops[1].raw("POST", "/transactions", { billId: b.id, amountCollected: 50, mode: "cash" }),
      ])
    );
    for (const b of bills) {
      const { bill, collected } = await liveTotals(b.id);
      if (bill.status === "refunded") {
        // Whatever was collected must be what was refunded.
        expect(Number(bill.refundedAmount), `bill ${bill.billNumber}`).toBe(collected);
        expect(Number(bill.balance)).toBe(0);
      } else {
        expect(Number(bill.balance), `bill ${bill.billNumber}`).toBe(100 - collected);
      }
    }
  });

  test("L5: a company settlement racing a payment cannot overpay a bill", async ({ adminApi }) => {
    const { company, category } = await adminApi.addCreditCategory();
    const bills = await Promise.all(
      Array.from({ length: TRIALS }, () => adminApi.createBill({ categoryId: category.id, originalAmount: 100 }))
    );
    await Promise.all([
      ops[0].raw("POST", `/companies/${company.id}/settle`, { billIds: bills.map((b) => b.id), mode: "cash" }),
      ...bills.map((b) => ops[1].raw("POST", "/transactions", { billId: b.id, amountCollected: 40, mode: "cash" })),
    ]);
    for (const b of bills) {
      const { bill, collected } = await liveTotals(b.id);
      expect(collected, `bill ${bill.billNumber}`).toBeLessThanOrEqual(100);
    }
  });

  test("L6: two admins reassigning the same bill keep history and current owner in sync", async ({ api }) => {
    const [adminA, adminB] = await Promise.all([createUser("admin"), createUser("admin")]);
    const [sa, sb] = await Promise.all([api(adminA), api(adminB)]);
    const owner = await createUser("operator");
    const [t1, t2] = await Promise.all([createUser("operator"), createUser("operator")]);
    const bills = await Promise.all(Array.from({ length: TRIALS }, async () => (await api(owner)).createBill()));

    await Promise.all(
      bills.flatMap((b) => [sa.raw("PATCH", `/bills/${b.id}/reassign-operator`, { operatorId: t1.id }),
        sb.raw("PATCH", `/bills/${b.id}/reassign-operator`, { operatorId: t2.id })])
    );
    for (const b of bills) {
      const bill = await db().bill.findUnique({
        where: { id: b.id },
        include: { reassignments: { orderBy: { reassignedAt: "asc" } } },
      });
      const last = bill.reassignments[bill.reassignments.length - 1];
      expect(last.toOperatorId, `bill ${bill.billNumber}`).toBe(bill.createdById);
      // Each move must start from the owner the previous move left behind.
      bill.reassignments.forEach((r, i) => {
        const expectedFrom = i === 0 ? owner.id : bill.reassignments[i - 1].toOperatorId;
        expect(r.fromOperatorId, `bill ${bill.billNumber} move ${i}`).toBe(expectedFrom);
      });
    }
  });
});
