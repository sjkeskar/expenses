// Payments, discounts and their approvals (pivot.md §4.2, §4.10).
const { test, expect } = require("../../fixtures");

test.describe("Payments", () => {
  test("payments reduce the balance; the last one makes the bill fully paid", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    await techApi.pay(bill.id, 150);
    expect(await techApi.getBill(bill.id)).toMatchObject({ balance: "250", status: "pending" });
    await techApi.pay(bill.id, 250, { mode: "credit_card" });
    expect(await techApi.getBill(bill.id)).toMatchObject({ balance: "0", status: "fully_paid" });
    const { status, body } = await techApi.raw("POST", "/transactions", { billId: bill.id, amountCollected: 1, mode: "cash" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/already fully paid/);
  });

  test("a payment above the balance, a junk amount or a bad mode is refused", async ({ techApi }) => {
    const bill = await techApi.createBill();
    for (const [body, error] of [
      [{ amountCollected: 301, mode: "cash" }, /exceeds the remaining balance \(300\.00\)/],
      [{ amountCollected: 200, discountAmount: 101, mode: "cash" }, /exceeds the remaining balance/],
      [{ amountCollected: "abc", mode: "cash" }, /positive number/],
      [{ amountCollected: -5, mode: "cash" }, /positive number/],
      [{ amountCollected: 0, mode: "cash" }, /positive number/],
      [{ amountCollected: 10, mode: "cheque" }, /mode must be/],
    ]) {
      const res = await techApi.raw("POST", "/transactions", { billId: bill.id, ...body });
      expect.soft(res.status, JSON.stringify(body)).toBe(400);
      expect.soft(res.body.error).toMatch(error);
    }
  });

  test("amounts with more than 2 decimals are rounded to the paisa", async ({ techApi }) => {
    const bill = await techApi.createBill();
    await techApi.pay(bill.id, 100.456);
    expect((await techApi.getBill(bill.id)).balance).toBe("199.54");
  });

  test("editing and deleting a payment re-apply the bill's totals (API only, BUG-006)", async ({ techApi }) => {
    const bill = await techApi.createBill();
    const payment = await techApi.pay(bill.id, 100, { discountAmount: 20 });
    expect(await techApi.getBill(bill.id)).toMatchObject({ discountAmount: "20", balance: "180" });

    await techApi.call("PATCH", `/transactions/${payment.id}`, { amountCollected: 50, discountAmount: 0 });
    expect(await techApi.getBill(bill.id)).toMatchObject({ discountAmount: "0", balance: "250" });

    const over = await techApi.raw("PATCH", `/transactions/${payment.id}`, { amountCollected: 400 });
    expect(over.status).toBe(400);

    await techApi.call("DELETE", `/transactions/${payment.id}`);
    expect(await techApi.getBill(bill.id)).toMatchObject({ balance: "300", status: "pending" });
  });
});

test.describe("Discount approvals and report holds", () => {
  test("a technician's discount holds the report until a pathologist approves it", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill({ discountAmount: 30 });
    expect(bill.holds).toEqual(["Discount awaiting approval"]);
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" });
    expect(approval.payload).toEqual({ from: "0.00", to: "30.00" });

    await (await api(users.path1)).decide(approval.id, "approve");
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);
  });

  test("a pathologist's or the lead's own discount is self-approved", async ({ api, users, leadApi }) => {
    for (const client of [await api(users.path1), leadApi]) {
      const bill = await client.createBill({ discountAmount: 30 });
      expect(bill.holds).toEqual([]);
      expect(await client.approvalFor({ billId: bill.id, subjectType: "bill_discount" })).toMatchObject({ status: "approved", selfApproved: true });
    }
  });

  test("a payment-time discount and later changes join one pending request", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill({ discountAmount: 10 });
    await techApi.pay(bill.id, 100, { discountAmount: 15 });
    await techApi.call("PATCH", `/bills/${bill.id}/discount`, { discountAmount: 40 });
    const requests = await (await api(users.path1)).call("GET", "/approvals");
    const mine = requests.approvals.filter((a) => a.billId === bill.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toEqual({ from: "0.00", to: "40.00" });
  });

  test("a rejected discount is reverted and holds the report until the full amount is paid", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill({ discountAmount: 100, initialPayment: { amount: 200, mode: "cash" } });
    expect(bill).toMatchObject({ balance: "0", status: "fully_paid" });
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" });
    await (await api(users.path1)).decide(approval.id, "reject", "No discount agreed");

    const reverted = await techApi.getBill(bill.id);
    expect(reverted).toMatchObject({ discountAmount: "0", balance: "100", status: "pending" });
    expect(reverted.holds).toEqual(["Discount rejected: full amount due"]);
    expect(reverted.events.map((e) => e.kind)).toEqual(["discount_reverted"]);

    await techApi.pay(bill.id, 100);
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);
  });

  test("a request can be reviewed once; technicians can't review", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill({ discountAmount: 30 });
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" });
    expect((await techApi.raw("POST", `/approvals/${approval.id}/approve`, {})).status).toBe(403);
    await (await api(users.path1)).decide(approval.id, "approve");
    const again = await (await api(users.path2)).raw("POST", `/approvals/${approval.id}/reject`, {});
    expect(again.status).toBe(409);
  });
});
