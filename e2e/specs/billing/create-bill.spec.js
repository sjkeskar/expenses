// D1–D21: the Create Bill form, run identically on operator.html and on
// admin.html's Billing tab (H12 — admin has the same billing powers).
const { test, expect, knownBug } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { BASELINE } = require("../../helpers/seed");
const { createUser, db, findBillByNumber } = require("../../helpers/db");
const { uid, inr, istDate } = require("../../helpers/data");

const LOC = BASELINE.location.name;
const STD = BASELINE.standardCategory.name;
const CREDIT = BASELINE.creditCategory.name;
const COMPANY = BASELINE.creditCategory.company;
const COL = BillingPage.COL;

for (const role of ["operator", "admin"]) {
  test.describe(`Create Bill as ${role}`, () => {
    let user;
    let ui;
    test.beforeEach(async ({ loginAs }) => {
      user = await createUser(role);
      ui = new BillingPage(await loginAs(user));
    });

    test("D1: picking an existing client reuses that client", async ({ adminApi }) => {
      const existing = await adminApi.createBill({ clientName: uid("Existing") });
      await ui.page.reload({ waitUntil: "networkidle" });

      const msg = await ui.createBill({ client: existing.client.name, category: STD, location: LOC, original: 500 });
      const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
      expect(bill.clientId).toBe(existing.client.id);
    });

    test("D2: typing a new client name creates the client; same name in other case/spacing is reused", async () => {
      const name = uid("NewClient");
      const msg1 = await ui.createBill({ client: name, newClient: true, category: STD, location: LOC, original: 100 });
      expect(msg1).toContain(`created for ${name}`);

      const msg2 = await ui.createBill({
        client: `   ${name.toUpperCase()}  `,
        newClient: true,
        category: STD,
        location: LOC,
        original: 100,
      });
      const [b1, b2] = await Promise.all(
        [msg1, msg2].map((m) => findBillByNumber(BillingPage.billNumberFrom(m)))
      );
      expect(b2.clientId).toBe(b1.clientId);
      expect(await db().client.count({ where: { name: { equals: name, mode: "insensitive" } } })).toBe(1);
    });

    test("D2b: a whitespace-only client name is rejected", async () => {
      await ui.fillBill({ client: "   ", newClient: true, category: STD, location: LOC, original: 100 });
      await ui.createBillButton.click();
      await expect(ui.billMsg).toHaveText("Enter a client name.");
    });

    test("D3: comboboxes work from the keyboard (arrows + Enter, Tab on a single match, Escape)", async ({ adminApi }) => {
      const prefix = uid("Kbd");
      await adminApi.createBill({ clientName: `${prefix} Alpha` });
      await adminApi.createBill({ clientName: `${prefix} Beta` });
      await ui.page.reload({ waitUntil: "networkidle" });

      // Two matches: ArrowDown twice + Enter picks the second.
      await ui.client.input.fill(prefix);
      await expect(ui.client.items).toHaveCount(2);
      await ui.client.input.press("ArrowDown");
      await ui.client.input.press("ArrowDown");
      await ui.client.input.press("Enter");
      await expect(ui.client.input).toHaveValue(`${prefix} Beta`);
      await expect(ui.client.hidden).not.toHaveValue("");
      await expect(ui.client.dropdown).toBeHidden();

      // Escape closes the list without selecting.
      await ui.client.input.fill(prefix);
      await expect(ui.client.dropdown).toBeVisible();
      await ui.client.input.press("Escape");
      await expect(ui.client.dropdown).toBeHidden();
      await expect(ui.client.hidden).toHaveValue("");

      // Narrowed to a single match: Tab commits it without arrowing.
      await ui.location.input.fill(LOC.slice(0, 8));
      await expect(ui.location.items).toHaveCount(1);
      await ui.location.input.press("Tab");
      await expect(ui.location.input).toHaveValue(LOC);
      await expect(ui.location.hidden).not.toHaveValue("");
    });

    test("D4: standard category — no company on the bill", async () => {
      const client = uid("Std");
      await ui.fillBill({ client, newClient: true, category: STD });
      await expect(ui.categoryInfo).toHaveText("");
      const msg = await ui.createBill({ location: LOC, original: 250 });
      expect(msg).not.toContain("billed to");
      const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
      expect(bill.companyId).toBeNull();
      await expect(ui.myBillRow(bill.billNumber).locator("td").nth(COL.company)).toHaveText("—");
    });

    test("D5: credit category — company is shown and copied from the category", async () => {
      await ui.category.pick(CREDIT);
      await expect(ui.categoryInfo).toHaveText(`Credit bill — will be billed to ${COMPANY}.`);
      const msg = await ui.createBill({ client: uid("Cr"), newClient: true, location: LOC, original: 250 });
      expect(msg).toContain(`(billed to ${COMPANY})`);
      const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
      const company = await db().company.findFirst({ where: { name: COMPANY } });
      expect(bill.companyId).toBe(company.id);
      await expect(ui.myBillRow(bill.billNumber).locator("td").nth(COL.company)).toHaveText(COMPANY);
    });

    test("D5b: clearing the category text clears the credit hint", async () => {
      await ui.category.pick(CREDIT);
      await expect(ui.categoryInfo).not.toHaveText("");
      await ui.category.input.fill("x");
      await expect(ui.categoryInfo).toHaveText("");
    });

    test("D6: a location not picked from the list is rejected", async () => {
      await ui.fillBill({ client: uid("C"), newClient: true, category: STD, original: 100 });
      await ui.location.type("Nowhere Street");
      await ui.createBillButton.click();
      await expect(ui.billMsg).toHaveText("Select a valid location from the suggestions list.");
    });

    test("D7: a category not picked from the list is rejected", async () => {
      await ui.fillBill({ client: uid("C"), newClient: true, location: LOC, original: 100 });
      await ui.category.type("Imaginary");
      await ui.createBillButton.click();
      await expect(ui.billMsg).toHaveText("Select a valid category from the suggestions list.");
    });

    test("D8a: zero/negative amounts are blocked by the form's own validation", async () => {
      let posted = false;
      ui.page.on("request", (r) => {
        if (r.url().endsWith("/api/bills") && r.method() === "POST") posted = true;
      });
      await ui.fillBill({ client: uid("C"), newClient: true, category: STD, location: LOC, original: 0 });
      await ui.createBillButton.click();
      expect(await ui.originalAmount.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);

      await ui.originalAmount.fill("100");
      await ui.discountAmount.fill("-1");
      await ui.createBillButton.click();
      expect(await ui.discountAmount.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);

      await ui.discountAmount.fill("0");
      await ui.initialAmount.fill("-5");
      await ui.createBillButton.click();
      expect(await ui.initialAmount.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);
      expect(posted).toBe(false);
    });

    test("D8b: discount larger than the original amount is rejected", async () => {
      const msg = await ui.createBill({
        client: uid("C"), newClient: true, category: STD, location: LOC, original: 100, discount: 150,
      });
      expect(msg).toBe("discountAmount cannot exceed originalAmount.");
    });

    test("D8c: collecting more than the net amount is rejected", async () => {
      const msg = await ui.createBill({
        client: uid("C"), newClient: true, category: STD, location: LOC, original: 100, discount: 10, initial: 95,
      });
      expect(msg).toBe("Amount collected now cannot exceed the bill's net amount.");
    });

    test("D9: collecting the full net amount up-front makes the bill Fully Paid", async () => {
      const msg = await ui.createBill({
        client: uid("Full"), newClient: true, category: STD, location: LOC, original: 1000, discount: 100, initial: 900, mode: "upi",
      });
      expect(msg).toContain("balance 0.00");
      const number = BillingPage.billNumberFrom(msg);
      const row = ui.myBillRow(number).locator("td");
      await expect(row.nth(COL.net)).toHaveText(inr(900));
      await expect(row.nth(COL.collected)).toHaveText(inr(900));
      await expect(row.nth(COL.discount)).toHaveText(inr(100));
      await expect(row.nth(COL.balance)).toHaveText(inr(0));
      await expect(row.nth(COL.status)).toHaveText("Fully Paid");

      const bill = await findBillByNumber(number);
      expect(bill.status).toBe("fully_paid");
      expect(bill.transactions).toHaveLength(1);
      expect(bill.transactions[0].mode).toBe("upi");
      expect(bill.transactions[0].operatorId).toBe(user.id);
    });

    test("D10: partial up-front payment leaves the bill Pending with the right balance", async () => {
      const msg = await ui.createBill({
        client: uid("Part"), newClient: true, category: STD, location: LOC, original: 1000, initial: 400,
      });
      expect(msg).toContain(`balance ${inr(600)}`);
      await expect(ui.myBillRow(BillingPage.billNumberFrom(msg)).locator("td").nth(COL.status)).toHaveText("Pending");
    });

    test("D11: nothing collected — Pending and no transaction row", async () => {
      const msg = await ui.createBill({ client: uid("Zero"), newClient: true, category: STD, location: LOC, original: 300 });
      const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
      expect(bill.status).toBe("pending");
      expect(Number(bill.balance)).toBe(300);
      expect(bill.transactions).toHaveLength(0);
    });

    for (const mode of ["cash", "credit_card", "upi"]) {
      test(`D12: up-front payment mode "${mode}" is stored`, async () => {
        const msg = await ui.createBill({
          client: uid("Mode"), newClient: true, category: STD, location: LOC, original: 100, initial: 50, mode,
        });
        const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
        expect(bill.transactions[0].mode).toBe(mode);
      });
    }

    test("D18: a location deleted while the form is open gives a clean error", async ({ adminApi }) => {
      const loc = await adminApi.addLocation({ locationCode: "02" });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.fillBill({ client: uid("C"), newClient: true, category: STD, location: loc.name, original: 100 });
      await adminApi.call("DELETE", `/locations/${loc.id}`);
      await ui.createBillButton.click();
      await expect(ui.billMsg).toHaveText("Select a valid location from the list.");
    });

    test("D19: a credit category with no linked company gives a clean error", async () => {
      const broken = await db().category.create({ data: { name: uid("Broken"), type: "credit" } });
      await ui.page.reload({ waitUntil: "networkidle" });
      const msg = await ui.createBill({
        client: uid("C"), newClient: true, category: broken.name, location: LOC, original: 100,
      });
      expect(msg).toBe("This category has no linked company configured. Please contact an admin to fix it.");
    });

    test("D20: form resets after success and the bill shows in My Bills and Record Payment", async () => {
      const client = uid("Reset");
      const msg = await ui.createBill({
        client, newClient: true, category: CREDIT, location: LOC, date: "2025-01-15", original: 700, discount: 5, initial: 10,
      });
      await expect(ui.billMsg).toHaveClass(/success/);
      await expect(ui.client.input).toHaveValue("");
      await expect(ui.client.hidden).toHaveValue("");
      await expect(ui.category.input).toHaveValue("");
      await expect(ui.location.input).toHaveValue("");
      await expect(ui.categoryInfo).toHaveText("");
      await expect(ui.billDate).toHaveValue(istDate());
      await expect(ui.originalAmount).toHaveValue("");
      await expect(ui.discountAmount).toHaveValue("0");
      await expect(ui.initialAmount).toHaveValue("0");

      const number = BillingPage.billNumberFrom(msg);
      await expect(ui.myBillRow(number)).toHaveCount(1);
      await ui.txBill.input.fill(number);
      await expect(ui.txBill.item(`${number} — ${client}`)).toHaveCount(1);
    });

    test("D21: large and fractional amounts are stored exactly and shown in Indian format", async () => {
      const msg = await ui.createBill({
        client: uid("Big"), newClient: true, category: STD, location: LOC, original: 999999.99, discount: 0.01,
      });
      const number = BillingPage.billNumberFrom(msg);
      await expect(ui.myBillRow(number).locator("td").nth(COL.net)).toHaveText("9,99,999.98");
      const bill = await findBillByNumber(number);
      expect(bill.netAmount.toString()).toBe("999999.98");
    });

    test("D21b: collecting exactly the net amount on a fractional bill is accepted", async () => {
      knownBug("BUG-008");
      // net = 0.30 - 0.10 = 0.20, computed in floating point as 0.19999999999999998
      const msg = await ui.createBill({
        client: uid("Float"), newClient: true, category: STD, location: LOC, original: 0.3, discount: 0.1, initial: 0.2,
      });
      expect(msg).toContain("balance 0.00");
    });
  });
}

test.describe("Bill date & timezone", () => {
  test("D13: the bill date defaults to today in IST even when the browser is in New York", async ({ loginAs, users }) => {
    // 20:00 UTC = 01:30 IST next day, but still the same day in New York.
    const instant = new Date("2026-10-15T20:00:00Z");
    const page = await loginAs(users.op1, { timezoneId: "America/New_York" });
    await page.clock.setFixedTime(instant);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#bill-date")).toHaveValue("2026-10-16");
  });

  test("D16b: a backdated bill is timestamped on the chosen IST calendar day", async ({ loginAs, users }) => {
    const ui = new BillingPage(await loginAs(users.op1));
    const msg = await ui.createBill({
      client: uid("Back"), newClient: true, category: STD, location: LOC, date: "2024-02-29", original: 100, initial: 100,
    });
    const bill = await findBillByNumber(BillingPage.billNumberFrom(msg));
    expect(istDate(bill.createdAt)).toBe("2024-02-29");
    expect(istDate(bill.transactions[0].createdAt)).toBe("2024-02-29");
    await expect(ui.myBillRow(bill.billNumber).locator("td").nth(COL.created)).toContainText("29/02/2024");
  });

  test("D17: an invalid calendar date is rejected by the API", async ({ adminApi }) => {
    for (const billDate of ["2026-02-30", "2026-13-01", "15-10-2026", "yesterday"]) {
      const loc = await adminApi.baselineLocation();
      const cat = await adminApi.baselineStandardCategory();
      const { status, body } = await adminApi.raw("POST", "/bills", {
        clientName: uid("D"), locationId: loc.id, categoryId: cat.id, originalAmount: 10, billDate,
      });
      expect(status, billDate).toBe(400);
      expect(body.error).toBe("billDate must be a valid date in YYYY-MM-DD format.");
    }
  });
});
