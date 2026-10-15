// K1–K4, K6: hostile and unusual input, double submits, server errors.
const { test, expect, knownBug } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { AdminPage } = require("../../pages/admin");
const { DeveloperPage } = require("../../pages/developer");
const { AnalyticsSection } = require("../../pages/analytics");
const { createUser, db, findBillByNumber } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");

// Sets window.__xss when executed. Wrapped in a unique marker so we can also
// check the text is displayed literally.
const payload = (tag) => `<img src=x onerror="window.__xss=(window.__xss||[]).concat('${tag}')">${tag}`;

async function xssFired(page) {
  return page.evaluate(() => window.__xss || []);
}

test.describe("Stored XSS (K1)", () => {
  test("K1a: a client name containing HTML is shown as text, never executed (operator & admin billing)", async ({ api, loginAs, users }) => {
    knownBug("BUG-004");
    const tag = uid("cx");
    const op = await api(users.op1);
    const bill = await op.createBill({ clientName: payload(tag), initialAmountCollected: 1 });

    const opPage = await loginAs(users.op1);
    const ui = new BillingPage(opPage);
    await ui.txBill.input.fill(bill.billNumber); // renders the client name in the combobox
    await ui.page.waitForTimeout(300);
    const adminPage = await loginAs(users.admin);
    const admin = new AdminPage(adminPage);
    await admin.openTab("reassign");
    await admin.reassign.bill.input.fill(bill.billNumber);
    await adminPage.waitForTimeout(300);

    expect(await xssFired(opPage)).toEqual([]);
    expect(await xssFired(adminPage)).toEqual([]);
    await expect(ui.myBillRow(bill.billNumber).locator("td").nth(1)).toHaveText(payload(tag));
  });

  test("K1b: client names are not executed in analytics (admin & accountant)", async ({ adminApi, loginAs, users }) => {
    knownBug("BUG-004");
    const tag = uid("ax");
    await adminApi.createBill({ clientName: payload(tag), originalAmount: 10 });
    for (const user of [users.admin, users.acct]) {
      const page = await loginAs(user);
      let a;
      if (user.role === "admin") {
        const admin = new AdminPage(page);
        await admin.openTab("analytics");
        a = admin.analytics;
      } else {
        a = new AnalyticsSection(page);
      }
      await a.clearRange();
      await page.waitForTimeout(300);
      expect(await xssFired(page), user.role).toEqual([]);
    }
  });

  test("K1c: location, category and company names are not executed", async ({ adminApi, loginAs, users }) => {
    knownBug("BUG-004");
    const tag = uid("lx");
    await adminApi.addLocation({ name: payload(`${tag}-loc`), locationCode: "03" });
    await adminApi.addCategory({ name: payload(`${tag}-cat`), type: "credit", companyName: payload(`${tag}-co`) });
    const page = await loginAs(users.admin);
    const admin = new AdminPage(page);
    await admin.openTab("locations");
    await admin.openTab("categories");
    await admin.openTab("billing");
    await admin.location.input.fill(tag);
    await admin.category.input.fill(tag);
    await page.waitForTimeout(300);
    expect(await xssFired(page)).toEqual([]);
  });

  test("K1d: user names are not executed on the developer page", async ({ loginAs, users }) => {
    knownBug("BUG-004");
    const tag = uid("ux");
    await createUser("operator", { name: payload(tag) });
    const page = await loginAs(users.dev);
    await new DeveloperPage(page).usersTable.waitFor();
    await page.waitForTimeout(300);
    expect(await xssFired(page)).toEqual([]);
  });
});

test.describe("Unusual input (K2, K3)", () => {
  test("K2: Unicode and long names round-trip and display correctly", async ({ loginAs, users }) => {
    const ui = new BillingPage(await loginAs(users.op1));
    const names = [`${uid("x")} श्री गणेश ट्रेडर्स`, `${uid("x")} Café 😀 & Sons`, `${uid("x")} ${"L".repeat(200)}`];
    for (const name of names) {
      const msg = await ui.createBill({
        client: name, newClient: true, category: BASELINE.standardCategory.name,
        location: BASELINE.location.name, original: 10,
      });
      expect(msg).toContain(`created for ${name}`);
      const number = BillingPage.billNumberFrom(msg);
      await expect(ui.myBillRow(number).locator("td").nth(1)).toHaveText(name);
      expect((await findBillByNumber(number)) && (await db().client.findFirst({ where: { name } }))).toBeTruthy();
    }
  });

  test("K3: number fields reject non-numeric text and the API rejects junk amounts", async ({ loginAs, users, adminApi }) => {
    const ui = new BillingPage(await loginAs(users.op1));
    await ui.originalAmount.pressSequentially("abc");
    await expect(ui.originalAmount).toHaveValue("");

    const loc = await adminApi.baselineLocation();
    const cat = await adminApi.baselineStandardCategory();
    for (const originalAmount of ["abc", "1,000", "", null, "Infinity", -5, 0]) {
      const { status } = await adminApi.raw("POST", "/bills", {
        clientName: uid("Junk"), locationId: loc.id, categoryId: cat.id, originalAmount,
      });
      expect(status, JSON.stringify(originalAmount)).toBe(400);
    }
    const bill = await adminApi.createBill({ originalAmount: 100 });
    for (const amountCollected of ["abc", "NaN", -1, 0]) {
      const { status } = await adminApi.raw("POST", "/transactions", { billId: bill.id, amountCollected, mode: "cash" });
      expect(status, JSON.stringify(amountCollected)).toBe(400);
    }
    expect((await adminApi.raw("POST", "/transactions", { billId: bill.id, amountCollected: 1, mode: "bitcoin" })).status).toBe(400);
  });

  test("K3b: amounts with more than 2 decimals are rounded on storage", async ({ adminApi }) => {
    const bill = await adminApi.createBill({ originalAmount: 100.456 });
    expect((await findBillByNumber(bill.billNumber)).originalAmount.toString()).toBe("100.46");
  });
});

test.describe("Double submits and server errors (K4, K6)", () => {
  test("K4a: double-clicking Create Bill creates exactly one bill", async ({ loginAs }) => {
    knownBug("BUG-010");
    const user = await createUser("operator");
    const ui = new BillingPage(await loginAs(user));
    const client = uid("Dbl");
    await ui.fillBill({
      client, newClient: true, category: BASELINE.standardCategory.name, location: BASELINE.location.name, original: 10,
    });
    await ui.createBillButton.dblclick();
    await expect(ui.billMsg).toContainText(`created for ${client}`);
    await ui.page.waitForTimeout(1000);
    expect(await db().bill.count({ where: { client: { name: client } } })).toBe(1);
  });

  test("K4b: double-clicking Record Payment records exactly one payment", async ({ loginAs, adminApi }) => {
    knownBug("BUG-010");
    const bill = await adminApi.createBill({ originalAmount: 100 });
    const ui = new BillingPage(await loginAs(await createUser("operator")));
    await ui.txBill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
    await ui.txAmount.fill("10");
    await ui.txSubmit.dblclick();
    await expect(ui.txMsg).toHaveText("Payment recorded.");
    await ui.page.waitForTimeout(1000);
    expect((await findBillByNumber(bill.billNumber)).transactions).toHaveLength(1);
  });

  test("K6: a server error is shown as a message, not a hang", async ({ loginAs, users }) => {
    const ui = new BillingPage(await loginAs(users.op1));
    await ui.page.route("**/api/bills", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not create bill." }) })
        : route.continue()
    );
    const msg = await ui.createBill({
      client: uid("Err"), newClient: true, category: BASELINE.standardCategory.name,
      location: BASELINE.location.name, original: 10,
    });
    expect(msg).toBe("Could not create bill.");
    await expect(ui.billMsg).toHaveClass(/error/);
  });

  test("K6b: a non-JSON error response still shows a readable message", async ({ loginAs, users, adminApi }) => {
    const bill = await adminApi.createBill({ originalAmount: 100 });
    const ui = new BillingPage(await loginAs(users.op1));
    await ui.page.route("**/api/transactions", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
    const msg = await ui.recordPayment({ billNumber: bill.billNumber, clientName: bill.client.name, amount: 5 });
    expect(msg).toBe("Request failed (502)");
  });
});

