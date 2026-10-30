// Step 5 and 6 screens: quotations (issue, thermal print, convert,
// re-issue) and analytics (presets, tally, PDFs).
const { test, expect } = require("../../fixtures");
const { db } = require("../../helpers/db");
const { uid, phone } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");

// A labelled figure (components/Page.tsx Figures), e.g. "Net amount".
const figure = (page, label) => page.getByRole("group", { name: label, exact: true });

test.describe("Quotations", () => {
  test("issue for a name and phone, print on the GT820 layout, then convert into a bill", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Quote"), phone()];
    const tech = await loginAs(users.tech1);
    await tech.getByRole("navigation", { name: "Quick access" }).getByRole("button", { name: "New quotation" }).click();
    // A quote opens on a name and phone, the name ready to type.
    await expect(tech.getByLabel("Name", { exact: true })).toBeFocused();
    await tech.keyboard.type(name);
    await tech.getByLabel(/^Phone/).fill(ph);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "LIPID");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("50");
    await expect(figure(tech, "Net amount")).toContainText("₹200.00");
    await tech.getByRole("button", { name: "Save & print" }).last().click();

    const sheet = tech.getByRole("main", { name: /^Quotation Q/ });
    for (const text of [BASELINE.settings.labName, BASELINE.branch.name, name, users.tech1.name, "Includes: Cholesterol, Triglycerides", "Valid for 48 hours, until"]) {
      await expect(sheet).toContainText(text);
    }
    const quote = await db().quotation.findFirst({ where: { patientName: name } });
    await expect(sheet).toContainText(quote.verificationCode);
    await expect.poll(() => tech.evaluate(() => window.__printed)).toBe(1);
    // The sheet is 104 mm wide; its page is as long as the content.
    expect(Math.round((await sheet.boundingBox()).width)).toBe(Math.round((104 * 96) / 25.4));

    await tech.getByRole("button", { name: "Done" }).click();
    await expect(tech.getByRole("heading", { name: `Quotation ${quote.quoteNumber}` })).toBeVisible();
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await expect(tech.getByRole("heading", { name: `Bill quotation ${quote.quoteNumber}` })).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹200.00");

    // The quote's name and phone are the new patient's, registered with the bill.
    await expect(tech.getByLabel("Full name")).toHaveValue(name);
    await expect(tech.getByLabel("Phone", { exact: true })).toHaveValue(ph);
    await tech.getByLabel("Age (years)").fill("52");
    await tech.getByLabel("Male", { exact: true }).check();
    await tech.getByRole("button", { name: "Create bill" }).last().click();

    await expect(tech.getByRole("heading", { name: /^Bill \d+/ })).toBeVisible();
    await expect(tech.getByRole("link", { name: quote.quoteNumber })).toBeVisible();
    await expect(tech.getByText(/Discount awaiting approval/)).toBeVisible();
    expect(await db().patient.count({ where: { phone: ph, name } })).toBe(1);
  });

  test("an expired quote whose price changed must be re-issued", async ({ loginAs, users, leadApi, techApi }) => {
    const code = uid("R").replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase();
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: "E2E re-issue", kind: "test", price: 100 } }] });
    const quote = await techApi.createQuote({ items: [code] });
    const issuedAt = new Date(Date.now() - 50 * 3600e3);
    await db().quotation.update({ where: { id: quote.id }, data: { issuedAt, validUntil: new Date(issuedAt.getTime() + 48 * 3600e3) } });
    const item = await db().catalogItem.findUnique({ where: { code } });
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "update", catalogItemId: item.id, values: { code, name: item.name, kind: "test", price: 120 } }] });

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByText(/has expired and its prices have changed/)).toBeVisible();
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);
    await tech.getByRole("button", { name: "Re-issue" }).click();
    await expect(tech.getByRole("main", { name: /^Quotation Q/ })).toContainText("₹120.00");
    await tech.getByRole("button", { name: "Done" }).click();
    await expect(tech.getByRole("link", { name: quote.quoteNumber })).toBeVisible(); // "Re-issue of"
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toBeVisible();
  });

  test("a quote converts from its row in the list", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations");
    await tech.getByLabel("Search quotations").fill(quote.quoteNumber);
    await tech.getByLabel("Search quotations").press("Enter");
    await tech.getByRole("row", { name: new RegExp(quote.quoteNumber) }).getByRole("button", { name: "Convert to bill" }).click();
    await expect(tech.getByRole("heading", { name: `Bill quotation ${quote.quoteNumber}` })).toBeVisible();
  });

  test("the list filters by status; expired is shown as such", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote();
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations");
    await tech.getByLabel("Search quotations").fill(quote.patientName);
    await tech.getByLabel("Search quotations").press("Enter");
    await expect(tech.getByRole("row", { name: new RegExp(quote.quoteNumber) })).toContainText("Valid");
    await tech.getByText("Billed", { exact: true }).click();
    await expect(tech.getByRole("row", { name: new RegExp(quote.quoteNumber) })).toHaveCount(0);
  });
});

test.describe("Analytics", () => {
  test("the accountant's tally for a period, and PDFs", async ({ loginAs, users }) => {
    const acct = await loginAs(users.acct);
    await acct.getByRole("menuitem", { name: "Analytics" }).click();
    await expect(acct.getByRole("heading", { name: "By payment mode" })).toBeVisible();
    await acct.getByText("This month", { exact: true }).click();
    await expect(acct.getByText(/^Period: 01\//)).toBeVisible();

    let download = acct.waitForEvent("download");
    await acct.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toBe("tally.pdf");

    await acct.getByRole("tab", { name: "Test-wise" }).click();
    await expect(acct.getByRole("heading", { name: "Test-wise" })).toBeVisible();
    download = acct.waitForEvent("download");
    await acct.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toBe("test-wise.pdf");

    await acct.getByText("Custom", { exact: true }).click();
    await expect(acct.getByPlaceholder("Start date")).toBeVisible();
  });

  test("the accountant can read but not act", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill();
    const acct = await loginAs(users.acct);
    await acct.goto(`/bills/${bill.id}`);
    await expect(acct.getByRole("button", { name: "Print bill" })).toBeVisible();
    for (const name of ["Record payment", "Cancel tests", "Change discount"]) await expect(acct.getByRole("button", { name })).toHaveCount(0);
    await expect(acct.getByRole("menuitem", { name: "Patients" })).toHaveCount(0);
  });
});
