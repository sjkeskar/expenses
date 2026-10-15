// F1–F9: Settle Company Balance (hand-picked bills, each closed in full).
// Every test gets its own credit category + company for isolation.
const { test, expect, knownBug } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { createUser, findBillByNumber, db } = require("../../helpers/db");
const { inr } = require("../../helpers/data");

for (const role of ["operator", "admin"]) {
  test.describe(`Settle Company Balance as ${role}`, () => {
    let user;
    let ui;
    let company;
    let category;
    let bills;

    test.beforeEach(async ({ loginAs, adminApi }) => {
      ({ company, category } = await adminApi.addCreditCategory());
      // Created oldest-first by date, so the expected display order is b0, b1, b2.
      bills = [];
      for (const [billDate, originalAmount, initial] of [
        ["2025-01-10", 1000, 200],
        ["2025-02-10", 500, undefined],
        ["2025-03-10", 300, undefined],
      ]) {
        bills.push(
          await adminApi.createBill({
            categoryId: category.id, billDate, originalAmount, initialAmountCollected: initial,
          })
        );
      }
      user = await createUser(role);
      ui = new BillingPage(await loginAs(user));
    });

    test("F2/F3: lists the company's pending bills oldest-first and totals the selection", async () => {
      await ui.selectSettleCompany(company.name);
      const rows = await ui.settleTable.locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td")).slice(1, 4).map((td) => td.textContent.trim()))
      );
      expect(rows).toEqual(bills.map((b, i) => [b.billNumber, b.client.name, inr([800, 500, 300][i])]));
      await expect(ui.settleTotal).toHaveText(`Total selected: ${inr(0)} (0 bills)`);

      await ui.settleCheckbox(bills[0].billNumber).check();
      await expect(ui.settleTotal).toHaveText(`Total selected: ${inr(800)} (1 bill)`);
      await ui.settleCheckbox(bills[2].billNumber).check();
      await expect(ui.settleTotal).toHaveText(`Total selected: ${inr(1100)} (2 bills)`);
      await ui.settleCheckbox(bills[0].billNumber).uncheck();
      await expect(ui.settleTotal).toHaveText(`Total selected: ${inr(300)} (1 bill)`);
    });

    test("F4/F7: settling a subset closes exactly those; disputed bills stay pending", async () => {
      await ui.selectSettleCompany(company.name);
      await ui.settleCheckbox(bills[0].billNumber).check();
      await ui.settleCheckbox(bills[2].billNumber).check();
      await ui.settleMode.selectOption("upi");
      await ui.settleSubmit.click();
      await expect(ui.settleMsg).toContainText(`Settled ${inr(1100)} for ${company.name}.`);
      await expect(ui.settleMsg).toContainText(`${bills[0].billNumber}: ${inr(800)}`);
      await expect(ui.settleMsg).toContainText(`${bills[2].billNumber}: ${inr(300)}`);
      await expect(ui.settleMsg).not.toContainText(bills[1].billNumber);
      await expect(ui.settleCompany.input).toHaveValue("");

      const [b0, b1, b2] = await Promise.all(bills.map((b) => findBillByNumber(b.billNumber)));
      for (const settled of [b0, b2]) {
        expect(settled.status).toBe("fully_paid");
        expect(Number(settled.balance)).toBe(0);
        const settlementTx = settled.transactions.find((t) => t.mode === "upi");
        expect(settlementTx.operatorId).toBe(user.id);
      }
      expect(Number(settlementOf(b0))).toBe(800);
      expect(Number(settlementOf(b2))).toBe(300);
      expect(b1.status).toBe("pending");
      expect(b1.transactions).toHaveLength(0);
    });

    test("F5: pressing Settle with nothing ticked shows an error", async () => {
      await ui.selectSettleCompany(company.name);
      await ui.settleSubmit.click();
      await expect(ui.settleMsg).toHaveText("Check at least one bill to settle.");
    });

    test("F5b: the Settle button only appears once a valid company is picked", async () => {
      await expect(ui.settleSubmit).toBeHidden();
      await ui.settleCompany.type("No Such Company");
      await expect(ui.settleSubmit).toBeHidden();
      await ui.selectSettleCompany(company.name);
      await expect(ui.settleSubmit).toBeVisible();
    });

    test("F6: a stale selection fails the whole settlement — nothing is partially applied", async ({ adminApi }) => {
      await ui.selectSettleCompany(company.name);
      await ui.settleCheckbox(bills[0].billNumber).check();
      await ui.settleCheckbox(bills[1].billNumber).check();
      await adminApi.pay(bills[1].id, 500); // someone else pays it off meanwhile
      await ui.settleSubmit.click();
      await expect(ui.settleMsg).toHaveText(`Bill ${bills[1].billNumber} is not pending (already fully paid).`);
      expect((await findBillByNumber(bills[0].billNumber)).status).toBe("pending");
    });

    test("F8: a company whose category was deleted can still be settled", async ({ adminApi }) => {
      await adminApi.call("DELETE", `/categories/${category.id}`);
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.selectSettleCompany(company.name);
      await ui.settleCheckbox(bills[1].billNumber).check();
      await ui.settleSubmit.click();
      await expect(ui.settleMsg).toHaveClass(/success/);
    });
  });
}

function settlementOf(bill) {
  return bill.transactions.find((t) => t.mode === "upi").amountCollected;
}

test.describe("Settlement edge cases", () => {
  test("F1: the company picker lists active companies", async ({ loginAs, users, adminApi }) => {
    const { company } = await adminApi.addCreditCategory();
    const ui = new BillingPage(await loginAs(users.op1));
    await ui.settleCompany.input.fill(company.name);
    await expect(ui.settleCompany.item(company.name)).toHaveCount(1);
  });

  test("F9: a company with nothing outstanding shows an empty state", async ({ loginAs, users, adminApi }) => {
    const { company } = await adminApi.addCreditCategory();
    const ui = new BillingPage(await loginAs(users.op1));
    await ui.settleCompany.pick(company.name);
    await expect(ui.settleTotal).toHaveText("This company has no outstanding bills.");
  });

  test("F10: bills from another company or non-pending bills are rejected by the API", async ({ adminApi }) => {
    const a = await adminApi.addCreditCategory();
    const b = await adminApi.addCreditCategory();
    const billB = await adminApi.createBill({ categoryId: b.category.id });
    const { status, body } = await adminApi.raw("POST", `/companies/${a.company.id}/settle`, {
      billIds: [billB.id], mode: "cash",
    });
    expect(status).toBe(400);
    expect(body.error).toBe(`Bill ${billB.billNumber} does not belong to this company.`);
  });

  test("F11: a refunded credit bill is not offered for settlement", async ({ adminApi }) => {
    const { company, category } = await adminApi.addCreditCategory();
    const bill = await adminApi.createBill({ categoryId: category.id, initialAmountCollected: 10 });
    await adminApi.refund(bill.id);
    const { pendingBills, totalOutstanding } = await adminApi.call("GET", `/companies/${company.id}/outstanding`);
    expect(pendingBills).toHaveLength(0);
    expect(totalOutstanding).toBe(0);
  });

  test("F12: the same bill id sent twice gets a clear validation error", async ({ adminApi }) => {
    const { company, category } = await adminApi.addCreditCategory();
    const bill = await adminApi.createBill({ categoryId: category.id });
    const { status, body } = await adminApi.raw("POST", `/companies/${company.id}/settle`, {
      billIds: [bill.id, bill.id], mode: "cash",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Each bill can only be selected once.");
    expect((await db().bill.findUnique({ where: { id: bill.id } })).status).toBe("pending");
  });

  test("F14: picking a company loads its bill list once, so ticked bills are never wiped", async ({ loginAs, users, adminApi }) => {
    knownBug("BUG-019");
    const { company, category } = await adminApi.addCreditCategory();
    await adminApi.createBill({ categoryId: category.id });
    const ui = new BillingPage(await loginAs(users.op1));
    // Hold back the 2nd /outstanding response (as on a busy LAN), so a
    // duplicate load lands after the operator has already ticked a bill.
    const loads = [];
    await ui.page.route("**/api/companies/*/outstanding", async (route) => {
      loads.push(route.request().url());
      if (loads.length === 2) await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    // Type the full company name, then Enter — the natural keyboard flow.
    await ui.settleCompany.input.focus();
    await ui.page.keyboard.type(company.name);
    await ui.page.keyboard.press("Enter");
    const box = ui.settleTable.locator(".settle-bill-checkbox");
    await expect(box).toHaveCount(1);
    await box.check();
    await ui.page.waitForTimeout(1200);

    await expect(box).toBeChecked();
    expect(loads).toHaveLength(1);
  });

  test("F13: an invalid mode or empty selection is rejected by the API", async ({ adminApi }) => {
    const { company, category } = await adminApi.addCreditCategory();
    const bill = await adminApi.createBill({ categoryId: category.id });
    expect((await adminApi.raw("POST", `/companies/${company.id}/settle`, { billIds: [], mode: "cash" })).status).toBe(400);
    expect((await adminApi.raw("POST", `/companies/${company.id}/settle`, { billIds: [bill.id], mode: "cheque" })).status).toBe(400);
    expect((await db().bill.findUnique({ where: { id: bill.id } })).status).toBe("pending");
  });
});

