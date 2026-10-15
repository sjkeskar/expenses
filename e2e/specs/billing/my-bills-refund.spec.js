// G1–G5: My Bills (own bills only, totals) and the whole-bill Refund flow.
const { test, expect } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { createUser, findBillByNumber } = require("../../helpers/db");
const { inr } = require("../../helpers/data");

const COL = BillingPage.COL;

for (const role of ["operator", "admin"]) {
  test.describe(`My Bills & Refund as ${role}`, () => {
    let user;
    let mine;
    test.beforeEach(async ({ api }) => {
      user = await createUser(role);
      mine = await api(user);
    });

    test("G1: shows only bills I created; follows reassignment in and out", async ({ loginAs, adminApi }) => {
      const own = await mine.createBill();
      const other = await createUser("operator");
      const theirs = await adminApi.createBill(); // created by the seeded admin
      const ui = new BillingPage(await loginAs(user));

      await expect(ui.myBillRow(own.billNumber)).toHaveCount(1);
      await expect(ui.myBillRow(theirs.billNumber)).toHaveCount(0);

      await adminApi.reassign(theirs.id, user.id);
      await adminApi.reassign(own.id, other.id);
      await ui.page.reload({ waitUntil: "networkidle" });
      await expect(ui.myBillRow(theirs.billNumber)).toHaveCount(1);
      await expect(ui.myBillRow(own.billNumber)).toHaveCount(0);
    });

    test("G2: totals row and summary add up, refunded bills listed but excluded", async ({ loginAs }) => {
      const a = await mine.createBill({ originalAmount: 1000, discountAmount: 100, initialAmountCollected: 400 });
      const b = await mine.createBill({ originalAmount: 500, initialAmountCollected: 500 });
      const c = await mine.createBill({ originalAmount: 300, initialAmountCollected: 100 });
      await mine.refund(c.id);
      const ui = new BillingPage(await loginAs(user));

      const rows = await ui.myBillRows();
      expect(rows).toHaveLength(4); // 3 bills + total row
      const total = rows[rows.length - 1];
      expect(total[0]).toBe("Total (2 bills, 1 refunded excluded)");
      expect(total.slice(1, 5)).toEqual([inr(1400), inr(900), inr(100), inr(500)]);

      await expect(ui.myBillsSummary).toHaveText(
        `Total bills: 3 (1 refunded) — Billed: ${inr(1500)}, Collected: ${inr(900)}, ` +
          `Discount: ${inr(100)}, Outstanding: ${inr(500)}`
      );

      const refunded = ui.myBillRow(c.billNumber).locator("td");
      await expect(refunded.nth(COL.collected)).toHaveText(inr(100));
      await expect(refunded.nth(COL.balance)).toHaveText(inr(0));
      await expect(refunded.nth(COL.status)).toHaveText("Refunded");
      for (const bill of [a, b]) await expect(ui.myBillRow(bill.billNumber)).toHaveCount(1);
    });

    test("G2b: an empty My Bills list has no totals row", async ({ loginAs }) => {
      const ui = new BillingPage(await loginAs(user));
      expect(await ui.myBillRows()).toHaveLength(0);
      await expect(ui.myBillsSummary).toContainText("Total bills: 0");
    });

    test("G3: Refund is offered only when money was collected and the bill isn't refunded", async ({ loginAs }) => {
      const nothingPaid = await mine.createBill({ originalAmount: 100 });
      const partlyPaid = await mine.createBill({ originalAmount: 100, initialAmountCollected: 10 });
      const fullyPaid = await mine.createBill({ originalAmount: 100, initialAmountCollected: 100 });
      const alreadyRefunded = await mine.createBill({ originalAmount: 100, initialAmountCollected: 10 });
      await mine.refund(alreadyRefunded.id);
      const ui = new BillingPage(await loginAs(user));

      const actions = (bill) => ui.myBillRow(bill.billNumber).locator("td").nth(COL.actions);
      await expect(actions(nothingPaid)).toHaveText("—");
      await expect(actions(alreadyRefunded)).toHaveText("—");
      for (const bill of [partlyPaid, fullyPaid]) {
        await expect(actions(bill).getByRole("button", { name: "Refund" })).toBeVisible();
      }
    });

    test("G4: refund modal — cancel and backdrop do nothing; confirm refunds the whole bill", async ({ loginAs }) => {
      const bill = await mine.createBill({ originalAmount: 1000, discountAmount: 50, initialAmountCollected: 600 });
      const ui = new BillingPage(await loginAs(user));
      const refundButton = ui.myBillRow(bill.billNumber).getByRole("button", { name: "Refund" });
      const modal = ui.refundModal;

      await refundButton.click();
      await expect(modal.modal).toBeVisible();
      await expect(modal.details).toHaveText(
        `Bill ${bill.billNumber} — ${bill.client.name}. Amount paid so far: ${inr(600)}. ` +
          "Confirm this amount has been refunded to the client?"
      );
      await modal.cancel.click();
      await expect(modal.modal).toBeHidden();

      await refundButton.click();
      await modal.modal.click({ position: { x: 5, y: 5 } });
      await expect(modal.modal).toBeHidden();
      expect((await findBillByNumber(bill.billNumber)).status).toBe("pending");

      await refundButton.click();
      await modal.confirm.click();
      await expect(modal.modal).toBeHidden();
      const row = ui.myBillRow(bill.billNumber).locator("td");
      await expect(row.nth(COL.status)).toHaveText("Refunded");
      await expect(row.nth(COL.actions)).toHaveText("—");

      const stored = await findBillByNumber(bill.billNumber);
      expect(stored).toMatchObject({ status: "refunded", refundedById: user.id });
      expect(Number(stored.refundedAmount)).toBe(600);
      expect(Number(stored.balance)).toBe(0);
      // Original figures are kept for audit.
      expect(Number(stored.originalAmount)).toBe(1000);
      expect(Number(stored.netAmount)).toBe(950);
      expect(stored.refundedAt).not.toBeNull();
    });

    test("G5: refunding a bill that was refunded meanwhile shows an error in the modal", async ({ loginAs }) => {
      const bill = await mine.createBill({ originalAmount: 100, initialAmountCollected: 100 });
      const ui = new BillingPage(await loginAs(user));
      await ui.myBillRow(bill.billNumber).getByRole("button", { name: "Refund" }).click();
      await mine.refund(bill.id);
      await ui.refundModal.confirm.click();
      await expect(ui.refundModal.msg).toHaveText("This bill has already been refunded.");
      await expect(ui.refundModal.modal).toBeVisible();
    });
  });
}

test("G3b: refunding a bill with nothing collected is rejected by the API", async ({ adminApi }) => {
  const bill = await adminApi.createBill({ originalAmount: 100 });
  const { status, body } = await adminApi.raw("PATCH", `/bills/${bill.id}/refund`);
  expect(status).toBe(400);
  expect(body.error).toBe("This bill has no collected amount to refund.");
});

test("G4b: an operator may refund a bill created by someone else (API)", async ({ api, users, adminApi }) => {
  const bill = await adminApi.createBill({ originalAmount: 100, initialAmountCollected: 30 });
  const op = await api(users.op2);
  const refunded = await op.refund(bill.id);
  expect(refunded.refundedBy.name).toBe(users.op2.name);
});
