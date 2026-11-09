// More quotation flows through the screens: quoting with a doctor, a panel
// and a discount, converting each kind of quote, a quote's dead ends
// (cancelled, converted, a branch that stopped home visits), and the
// New quotation form's validation.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, phone, istDate } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");

const figure = (page, label) => page.getByRole("group", { name: label, exact: true });
const billHeading = (page) => page.getByRole("heading", { name: /^Bill \d+/ });
const saveQuote = (page) => page.getByRole("button", { name: "Save & print" }).last().click();

async function pick(page, name, option) {
  const box = page.getByRole("combobox", { name: new RegExp(`^${name}`) });
  await box.click();
  await box.fill(option);
  await page.locator(".ant-select-dropdown:visible").getByTitle(option, { exact: true }).click();
}

const code = () => uid("Q").replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase();

test.describe("Issuing in the app", () => {
  test("a registered patient's quote with a doctor, an insurer and a discount converts with all of it", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByRole("button", { name: "Returning patient? Search registered patients" }).click();
    await tech.keyboard.type(patient.phone);
    await tech.locator(".ant-select-dropdown:visible").getByTitle(new RegExp(`^${patient.name} · `)).click();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await tech.getByRole("radio", { name: "Doctor" }).check();
    await pick(tech, "Referring doctor", BASELINE.doctor);
    await tech.getByRole("radio", { name: "Panel" }).check();
    await pick(tech, "Panel", BASELINE.insurer);
    await addItem(tech, "CBC");
    await addItem(tech, "GLUF");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("40");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00"); // 250 + 90 - 40
    await saveQuote(tech);
    await expect(tech.getByRole("main", { name: /^Quotation Q/ })).toContainText(patient.name);
    await tech.getByRole("button", { name: "Done" }).click();

    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await expect(tech.getByRole("heading", { name: /^Bill quotation Q/ })).toBeVisible();
    // The quote's patient is chosen already; no new patient's fields.
    await expect(tech.getByText(patient.patientNumber)).toBeVisible();
    await expect(tech.getByLabel("Full name")).toHaveCount(0);
    await expect(tech.getByRole("spinbutton", { name: /^Discount/ })).toHaveValue("40");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    await tech.getByRole("button", { name: "Create bill" }).last().click();

    await expect(billHeading(tech)).toBeVisible();
    const main = tech.getByRole("main");
    await expect(main).toContainText(`Doctor: ${BASELINE.doctor}`);
    await expect(main).toContainText(BASELINE.insurer);
    await expect(figure(tech, "Discount")).toContainText("₹40.00");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    await expect(tech.getByRole("link", { name: patient.name })).toBeVisible();
  });

  test("the form names what's missing or wrong, and saves nothing", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await saveQuote(tech);
    await expect(tech.getByText("Enter the patient's name")).toBeVisible();
    await expect(tech.getByText("Add at least one test, profile or service")).toBeVisible();

    await tech.getByLabel("Name", { exact: true }).fill("   ");
    await tech.getByLabel(/^Phone/).fill("12345");
    await saveQuote(tech);
    await expect(tech.getByText("Enter the patient's name")).toBeVisible(); // spaces aren't a name
    await expect(tech.getByText("Enter a 10-digit phone number")).toBeVisible();

    const name = uid("Quoted");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await tech.getByLabel(/^Phone/).fill(phone());
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("150");
    await saveQuote(tech);
    await expect(tech.getByText(/discount/i).filter({ hasText: /exceed|more than|total/i }).first()).toBeVisible();
    expect(await db().quotation.count({ where: { patientName: name } })).toBe(0);
  });

  test("double-clicking Save & print issues one quote", async ({ loginAs, users }) => {
    const name = uid("Quoted");
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await tech.getByRole("button", { name: "Save & print" }).last().dblclick();
    await expect(tech.getByRole("main", { name: /^Quotation Q/ })).toBeVisible();
    expect(await db().quotation.count({ where: { patientName: name } })).toBe(1);
  });
});

test.describe("Converting in the app", () => {
  test("a GTT quote converts with a draw left for a revisit and a part payment", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GTT"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await expect(tech.getByLabel("Full name")).toHaveValue(quote.patientName);
    await tech.getByLabel("Age (years)").fill("33");
    await tech.getByLabel("Male", { exact: true }).check();
    await tech.getByLabel("GTT 2 h collected now").click();
    const due = tech.getByLabel("GTT 2 h due back");
    const [y, m, d] = istDate(new Date(Date.now() + 24 * 3600e3)).split("-");
    await due.fill(`${d}/${m}/${y} 09:00 AM`);
    await due.press("Enter");
    await tech.getByLabel("Paid now").fill("200");
    await expect(figure(tech, "Balance after payment")).toContainText("₹300.00");
    await tech.getByRole("button", { name: "Create bill" }).last().click();

    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹300.00");
    await expect(tech.getByRole("row", { name: /GTT · Glucose tolerance 2 h/ })).toContainText("Pending");
    await expect(tech.getByRole("link", { name: quote.quoteNumber })).toBeVisible();
  });

  test("a quote for someone already registered offers that patient instead of a duplicate", async ({ loginAs, users, techApi }) => {
    const existing = await techApi.registerPatient({ sex: "female", ageYears: 45 });
    const quote = await techApi.createQuote({ items: ["GLUF"], patientName: existing.name, patientPhone: existing.phone });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await tech.getByLabel("Age (years)").fill("45");
    await tech.getByLabel("Female", { exact: true }).check();
    await tech.getByRole("button", { name: "Create bill" }).last().click();
    // The same details find the registered patient (no duplicate is made).
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("link", { name: existing.name })).toBeVisible();
    expect(await db().patient.count({ where: { phone: existing.phone } })).toBe(1);
    const bill = await db().bill.findFirst({ where: { quotationId: quote.id } });
    expect(bill.patientId).toBe(existing.id);
  });

  test("a converted quote links to its bill and offers nothing more; its old convert link can't bill again", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const patient = await techApi.registerPatient();
    const { bill } = await techApi.call("POST", "/bills", { quotationId: quote.id, patientId: patient.id });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("link", { name: bill.billNumber })).toBeVisible();
    for (const name of ["Convert to bill", "Cancel quotation", "Re-issue"]) {
      await expect(tech.getByRole("button", { name })).toHaveCount(0);
    }

    await tech.goto(`/bills/new?quotation=${quote.id}&patient=${patient.id}`);
    await tech.getByRole("button", { name: "Create bill" }).last().click();
    await expect(tech.getByText(new RegExp(`Quotation ${quote.quoteNumber} is converted`)).first()).toBeVisible();
    expect(await db().bill.count({ where: { quotationId: quote.id } })).toBe(1);
  });

  test("a cancelled quote can't be converted", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await tech.getByRole("button", { name: "Cancel quotation" }).click();
    const confirm = tech.getByRole("tooltip");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toBeVisible();
    await tech.getByRole("button", { name: "Cancel quotation" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Cancel quotation" }).click();
    await expect(tech.getByText("The quotation is cancelled.")).toBeVisible();
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);
    await expect(tech.getByRole("button", { name: "Cancel quotation" })).toHaveCount(0);
  });

  test("a home-visit quote at a branch that has since stopped home visits says why it can't convert", async ({ loginAs, users, techApi, leadApi }) => {
    const loc = await leadApi.addLocation({ homeVisitCharge: 150 });
    const quote = await techApi.createQuote({ items: ["GLUF"], locationId: loc.id, collectionMode: "home_visit" });
    await leadApi.call("PATCH", `/locations/${loc.id}`, { homeVisitCharge: null });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("alert")).toContainText(`${loc.name} doesn't offer home visits.`);
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);
  });

  test("re-issuing an expired home-visit quote keeps its home-visit charge", async ({ loginAs, users, techApi, leadApi }) => {
    const c = code();
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code: c, name: "E2E re-issue visit", kind: "test", price: 100 } }] });
    const quote = await techApi.createQuote({ items: [c], collectionMode: "home_visit", homeVisitCharge: 275 });
    const issuedAt = new Date(Date.now() - 50 * 3600e3);
    await db().quotation.update({ where: { id: quote.id }, data: { issuedAt, validUntil: new Date(issuedAt.getTime() + 48 * 3600e3) } });
    const item = await db().catalogItem.findUnique({ where: { code: c } });
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "update", catalogItemId: item.id, values: { code: c, name: item.name, kind: "test", price: 130 } }] });

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await tech.getByRole("button", { name: "Re-issue" }).click();
    const sheet = tech.getByRole("main", { name: /^Quotation Q/ });
    await expect(sheet).toContainText("₹130.00");
    await expect(sheet).toContainText("₹275.00");
    const fresh = await db().quotation.findFirst({ where: { reissuedFromId: quote.id }, include: { items: true } });
    expect(fresh.items.map((i) => [i.code, String(i.price)])).toEqual([[c, "130"], ["HOMEVISIT", "275"]]);
  });

  test("an accountant can open a quote but not convert, cancel or re-issue it", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const acct = await loginAs(users.acct);
    await acct.goto(`/quotations/${quote.id}`);
    await expect(acct.getByRole("heading", { name: `Quotation ${quote.quoteNumber}` })).toBeVisible();
    for (const name of ["Convert to bill", "Cancel quotation", "Re-issue"]) {
      await expect(acct.getByRole("button", { name })).toHaveCount(0);
    }
  });
});
