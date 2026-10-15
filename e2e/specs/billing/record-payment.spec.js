// E1–E9: Record Payment (top-ups on pending bills), on operator and admin pages.
const { test, expect, knownBug } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { createUser, findBillByNumber } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { inr } = require("../../helpers/data");

for (const role of ["operator", "admin"]) {
  test.describe(`Record Payment as ${role}`, () => {
    let user;
    let ui;
    test.beforeEach(async ({ loginAs }) => {
      user = await createUser(role);
      ui = new BillingPage(await loginAs(user));
    });

    test("E1: the bill picker lists only pending bills, searchable by number or client", async ({ adminApi }) => {
      const pending = await adminApi.createBill({ originalAmount: 100 });
      const paid = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 100 });
      const refunded = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 50 });
      await adminApi.refund(refunded.id);
      await ui.page.reload({ waitUntil: "networkidle" });

      await ui.txBill.input.fill(pending.billNumber);
      await expect(ui.txBill.item(`${pending.billNumber} — ${pending.client.name}`)).toHaveCount(1);
      await expect(ui.txBill.dropdown).toContainText(`Balance: ${inr(100)}`);

      await ui.txBill.input.fill(pending.client.name);
      await expect(ui.txBill.item(`${pending.billNumber} — ${pending.client.name}`)).toHaveCount(1);

      for (const hidden of [paid, refunded]) {
        await ui.txBill.input.fill(hidden.billNumber);
        await expect(ui.txBill.items).toHaveCount(0);
      }
    });

    test("E1b: submitting without picking a bill shows an error", async () => {
      await ui.txBill.type("not-a-bill");
      await ui.txAmount.fill("10");
      await ui.txSubmit.click();
      await expect(ui.txMsg).toHaveText("Select a valid pending bill from the suggestions list.");
    });

    test("E2: a partial payment reduces the balance and stays Pending", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 1000 });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.recordPayment({
        billNumber: bill.billNumber, clientName: bill.client.name, amount: 250, mode: "credit_card",
      });
      expect(msg).toBe("Payment recorded.");
      await expect(ui.txBill.input).toHaveValue("");
      await expect(ui.txAmount).toHaveValue("");

      const stored = await findBillByNumber(bill.billNumber);
      expect(Number(stored.balance)).toBe(750);
      expect(stored.status).toBe("pending");
      expect(stored.transactions[0]).toMatchObject({ mode: "credit_card", operatorId: user.id, createdById: user.id });
    });

    test("E3: paying the exact remaining balance makes the bill Fully Paid and removes it from the picker", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 500, initialAmountCollected: 200 });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.recordPayment({ billNumber: bill.billNumber, clientName: bill.client.name, amount: 300 });

      expect((await findBillByNumber(bill.billNumber)).status).toBe("fully_paid");
      await ui.txBill.input.fill(bill.billNumber);
      await expect(ui.txBill.items).toHaveCount(0);
    });

    test("E4: overpaying is rejected with the remaining balance in the message", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 100 });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.recordPayment({ billNumber: bill.billNumber, clientName: bill.client.name, amount: 150 });
      expect(msg).toBe("amountCollected + discountAmount (150) exceeds the remaining balance (100).");
      await expect(ui.txMsg).toHaveClass(/error/);
    });

    test("E5: an extra discount reduces balance and is folded into the bill's discount/net", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 1000, discountAmount: 100 });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.recordPayment({
        billNumber: bill.billNumber, clientName: bill.client.name, amount: 800, discount: 100,
      });
      expect(msg).toBe(`Payment recorded — ${inr(800)} collected plus ${inr(100)} discount applied.`);

      const stored = await findBillByNumber(bill.billNumber);
      expect(Number(stored.discountAmount)).toBe(200);
      expect(Number(stored.netAmount)).toBe(800);
      expect(Number(stored.balance)).toBe(0);
      expect(stored.status).toBe("fully_paid");
      expect(Number(stored.transactions[0].discountAmount)).toBe(100);
    });

    test("E5b: amount + discount above the balance is rejected", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 100 });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.recordPayment({
        billNumber: bill.billNumber, clientName: bill.client.name, amount: 60, discount: 50,
      });
      expect(msg).toBe("amountCollected + discountAmount (110) exceeds the remaining balance (100).");
    });

    test("E6: zero or negative amounts are blocked by form validation", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 100 });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.txBill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
      for (const bad of ["0", "-10"]) {
        await ui.txAmount.fill(bad);
        await ui.txSubmit.click();
        expect(await ui.txAmount.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);
      }
      await ui.txAmount.fill("10");
      await ui.txDiscount.fill("-1");
      await ui.txSubmit.click();
      expect(await ui.txDiscount.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);
      expect(Number((await findBillByNumber(bill.billNumber)).balance)).toBe(100);
    });

    test("E7: anyone can top up another user's bill; the payment is credited to whoever took it", async ({ api }) => {
      const otherOp = await createUser("operator");
      const bill = await (await api(otherOp)).createBill({ originalAmount: 400 });
      await ui.page.reload({ waitUntil: "networkidle" });
      await expect(ui.myBillRow(bill.billNumber)).toHaveCount(0); // not in MY bills

      await ui.recordPayment({ billNumber: bill.billNumber, clientName: bill.client.name, amount: 400 });
      const stored = await findBillByNumber(bill.billNumber);
      expect(stored.createdById).toBe(otherOp.id);
      expect(stored.transactions[0].operatorId).toBe(user.id);
    });

    test("E8: paying a bill someone else just paid off (stale picker) is rejected", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 100 });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.txBill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
      await adminApi.pay(bill.id, 100);
      await ui.txAmount.fill("10");
      await ui.txSubmit.click();
      await expect(ui.txMsg).toHaveText("This bill is already fully paid.");
    });

    test("E9: a refunded bill cannot receive payments", async ({ adminApi }) => {
      const bill = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 40 });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.txBill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
      await adminApi.refund(bill.id);
      await ui.txAmount.fill("10");
      await ui.txSubmit.click();
      await expect(ui.txMsg).toHaveClass(/error/);
      expect((await findBillByNumber(bill.billNumber)).status).toBe("refunded");
    });

    test("E10: amount + discount that exactly equals a fractional balance is accepted", async ({ adminApi }) => {
      knownBug("BUG-008");
      // 0.1 + 0.2 = 0.30000000000000004 in floating point, which is > 0.30
      const bill = await adminApi.createBill({ originalAmount: 0.3 });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.recordPayment({
        billNumber: bill.billNumber, clientName: bill.client.name, amount: 0.1, discount: 0.2,
      });
      expect(msg).toContain("Payment recorded");
    });
  });
}

test.describe("Transaction edit/delete (API only — no UI exists, see BUG-006)", () => {
  test("E11: editing a transaction re-applies amount and discount to the bill", async ({ adminApi }) => {
    const bill = await adminApi.createBill({ originalAmount: 1000 });
    const tx = await adminApi.pay(bill.id, 300, { discountAmount: 50 });
    await adminApi.call("PATCH", `/transactions/${tx.id}`, { amountCollected: 400, discountAmount: 100, mode: "upi" });
    const stored = await findBillByNumber(bill.billNumber);
    expect(Number(stored.balance)).toBe(500);
    expect(Number(stored.discountAmount)).toBe(100);
    expect(Number(stored.netAmount)).toBe(900);
    expect(stored.transactions[0]).toMatchObject({ mode: "upi" });
    expect(stored.transactions[0].updatedById).not.toBeNull();
  });

  test("E12: deleting a transaction restores balance and removes its discount", async ({ adminApi }) => {
    const bill = await adminApi.createBill({ originalAmount: 1000 });
    const tx = await adminApi.pay(bill.id, 900, { discountAmount: 100 });
    expect((await findBillByNumber(bill.billNumber)).status).toBe("fully_paid");
    await adminApi.call("DELETE", `/transactions/${tx.id}`);
    const stored = await findBillByNumber(bill.billNumber);
    expect(Number(stored.balance)).toBe(1000);
    expect(Number(stored.discountAmount)).toBe(0);
    expect(stored.status).toBe("pending");
    expect((await adminApi.raw("DELETE", `/transactions/${tx.id}`)).status).toBe(404);
  });

  test("E13: editing a transaction above the bill's balance is rejected", async ({ adminApi }) => {
    const bill = await adminApi.createBill({ originalAmount: 100 });
    const tx = await adminApi.pay(bill.id, 40);
    const { status } = await adminApi.raw("PATCH", `/transactions/${tx.id}`, { amountCollected: 101 });
    expect(status).toBe(400);
  });

  test("E14: deleting a payment on a refunded bill must not silently un-refund it", async ({ adminApi }) => {
    knownBug("BUG-002");
    const bill = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 60 });
    const [tx] = (await adminApi.getBill(bill.id)).transactions;
    await adminApi.refund(bill.id);
    const res = await adminApi.raw("DELETE", `/transactions/${tx.id}`);
    const stored = await findBillByNumber(bill.billNumber);
    expect(res.status).toBe(400);
    expect(stored.status).toBe("refunded");
  });

  test("E15: editing a payment on a refunded bill must not silently un-refund it", async ({ adminApi }) => {
    knownBug("BUG-002");
    const bill = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 60 });
    const [tx] = (await adminApi.getBill(bill.id)).transactions;
    await adminApi.refund(bill.id);
    const res = await adminApi.raw("PATCH", `/transactions/${tx.id}`, { amountCollected: 10 });
    const stored = await findBillByNumber(bill.billNumber);
    expect(res.status).toBe(400);
    expect(stored.status).toBe("refunded");
  });

  test("E16: the operator and admin pages offer a way to correct or delete a payment", async ({ loginAs, users }) => {
    knownBug("BUG-006");
    for (const user of [users.op1, users.admin]) {
      const page = await loginAs(user);
      await expect(
        page.getByRole("button", { name: /edit payment|delete payment|edit transaction|delete transaction/i })
      ).not.toHaveCount(0, { timeout: 1000 });
    }
  });
});
