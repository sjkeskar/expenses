// The customer's quotation journey through the screens: a quote holds its
// prices for 48 hours; after that it converts only while every price is
// unchanged, and can always be re-issued at today's prices. Plus the quote
// form's limits, and what happens when something changes between the quote
// and the bill.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, phone, istDate, billPrefix } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");
const { figure, billHeading, createBill, saveQuote, pick, addCatalogItem, setPrice, retire, expireQuote, addCamp, fillNewPatient } = require("../../helpers/flows");

const quoteSheet = (page) => page.getByRole("main", { name: /^Quotation Q/ });

// Searches the quotations list for one quote and returns its row.
async function findInList(page, quote) {
  await page.getByLabel("Search quotations").fill(quote.quoteNumber);
  await page.getByLabel("Search quotations").press("Enter");
  return page.getByRole("row", { name: new RegExp(quote.quoteNumber) });
}

test.describe("The 48 hours", () => {
  test("a price rise inside 48 hours doesn't touch the quote: it bills at the quoted price", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code] });
    await setPrice(leadApi, item, 140);

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("alert")).toHaveCount(0); // nothing to warn about
    await expect(tech.getByRole("button", { name: "Re-issue" })).toHaveCount(0);
    await expect(tech.getByRole("row", { name: new RegExp(`^${item.code}`) })).toContainText("₹100.00");
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await expect(tech.getByRole("heading", { name: `Bill quotation ${quote.quoteNumber}` })).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await expect(tech.getByRole("row", { name: new RegExp(`^${item.code}`) })).toContainText("₹100.00");

    // Someone without the quote pays today's price.
    const patient = await techApi.registerPatient();
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, item.code);
    await expect(figure(tech, "Net amount")).toContainText("₹140.00");
  });

  test("a price cut inside 48 hours: the quote still bills at its quoted price", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 200 });
    const quote = await techApi.createQuote({ items: [item.code] });
    await setPrice(leadApi, item, 150);
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await expect(figure(tech, "Net amount")).toContainText("₹200.00");
  });

  test("past 48 hours with every price unchanged: it says so, and still becomes a bill", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code] });
    await expireQuote(quote.id);

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("main")).toContainText("Expired");
    await expect(tech.getByText("This quotation has expired, but every price is unchanged, so it can still become a bill.")).toBeVisible();
    await expect(tech.getByRole("button", { name: "Re-issue" })).toBeVisible(); // either way is offered
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await expect(tech.getByRole("link", { name: quote.quoteNumber })).toBeVisible();
  });

  test("past 48 hours with every price unchanged: it can be re-issued instead, for a fresh 48 hours", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code] });
    await expireQuote(quote.id);

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await tech.getByRole("button", { name: "Re-issue" }).click();
    await expect(quoteSheet(tech)).toContainText("₹100.00");
    await expect(quoteSheet(tech)).toContainText("Valid for 48 hours, until");
    const fresh = await db().quotation.findFirst({ where: { reissuedFromId: quote.id } });
    expect(fresh.quoteNumber).not.toBe(quote.quoteNumber);
    expect(fresh.validUntil.getTime()).toBeGreaterThan(Date.now() + 47 * 3600e3);
    await tech.getByRole("button", { name: "Done" }).click();
    await expect(tech.getByRole("heading", { name: `Quotation ${fresh.quoteNumber}` })).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Valid");
  });

  test("a quote still inside its 48 hours can't be re-issued", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toBeVisible();
    await expect(tech.getByRole("button", { name: "Re-issue" })).toHaveCount(0);
  });

  test("a re-issued quote points at its replacement and can't be converted or re-issued again", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code] });
    await expireQuote(quote.id);
    await setPrice(leadApi, item, 130);
    const { quotation: fresh } = await techApi.call("POST", `/quotations/${quote.id}/reissue`);

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("alert")).toContainText(`was re-issued as ${fresh.quoteNumber}`);
    for (const name of ["Convert to bill", "Re-issue"]) await expect(tech.getByRole("button", { name })).toHaveCount(0);
    // Its old convert link can't bill it either.
    const patient = await techApi.registerPatient();
    await tech.goto(`/bills/new?quotation=${quote.id}&patient=${patient.id}`);
    await createBill(tech);
    await expect(tech.getByText(new RegExp(`was re-issued as ${fresh.quoteNumber}`)).first()).toBeVisible();
    expect(await db().bill.count({ where: { quotationId: quote.id } })).toBe(0);

    await tech.goto(`/quotations/${quote.id}`);
    await tech.getByRole("link", { name: fresh.quoteNumber }).click();
    await expect(tech.getByRole("heading", { name: `Quotation ${fresh.quoteNumber}` })).toBeVisible();
    await expect(tech.getByRole("row", { name: new RegExp(`^${item.code}`) })).toContainText("₹130.00");
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toBeVisible();
  });

  test("an expired quote with a test that has since been retired: the screen says what to do", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code, "GLUF"] });
    await expireQuote(quote.id);
    await retire(leadApi, item);

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);
    await tech.getByRole("button", { name: "Re-issue" }).click();
    // Re-issuing can't price a retired test: the technician is told, and nothing is issued.
    await expect(tech.getByText(/aren't in the active catalog/).first()).toBeVisible();
    await expect(tech.getByRole("heading", { name: `Quotation ${quote.quoteNumber}` })).toBeVisible();
    expect(await db().quotation.count({ where: { reissuedFromId: quote.id } })).toBe(0);
  });

  test("the list offers Convert only where it will work: valid, expired-unchanged, but not expired with a new price", async ({ loginAs, users, leadApi, techApi }) => {
    const [same, changed] = [await addCatalogItem(leadApi, { price: 100 }), await addCatalogItem(leadApi, { price: 100 })];
    const valid = await techApi.createQuote({ items: [same.code] });
    const expiredSame = await techApi.createQuote({ items: [same.code] });
    const expiredChanged = await techApi.createQuote({ items: [changed.code] });
    await expireQuote(expiredSame.id);
    await expireQuote(expiredChanged.id);
    await setPrice(leadApi, changed, 125);

    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations");
    let row = await findInList(tech, valid);
    await expect(row).toContainText("Valid");
    await expect(row.getByRole("button", { name: "Convert to bill" })).toBeVisible();
    row = await findInList(tech, expiredSame);
    await expect(row).toContainText("Expired");
    await expect(row.getByRole("button", { name: "Convert to bill" })).toBeVisible();
    row = await findInList(tech, expiredChanged);
    await expect(row).toContainText("Expired");
    await expect(row.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);

    // The Expired filter keeps the expired one and drops the valid one.
    await tech.locator(".ant-segmented").getByText("Expired", { exact: true }).click();
    await expect(row).toBeVisible();
    await expect(await findInList(tech, valid)).toHaveCount(0);
  });
});

test.describe("The quotation form", () => {
  test("home visits are offered only where the place has a charge", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await expect(tech.getByLabel("Home visit")).toBeDisabled(); // no place chosen yet
    for (const place of [BASELINE.noVisitBranch.name, BASELINE.centre.name]) {
      await chooseOption(tech, "Branch or centre", place);
      await expect(tech.getByLabel("Home visit")).toBeDisabled();
    }
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await tech.getByLabel("Home visit").check();
    await expect(tech.getByLabel("Home-visit charge")).toHaveValue("200");
    await addItem(tech, "CBC");
    await expect(tech.getByRole("row", { name: /HOMEVISIT/ })).toContainText("₹200.00");
    await expect(figure(tech, "Net amount")).toContainText("₹500.00");
  });

  test("a home-visit charge typed below the minimum is never quoted below it", async ({ loginAs, users }) => {
    const name = uid("Quoted");
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await tech.getByLabel("Home visit").check();
    await tech.getByLabel("Home-visit charge").fill("50");
    await tech.getByLabel("Home-visit charge").blur();
    await saveQuote(tech);
    await expect(quoteSheet(tech)).toContainText("Home visit");
    const quote = await db().quotation.findFirst({ where: { patientName: name }, include: { items: true } });
    expect(String(quote.items.find((i) => i.code === "HOMEVISIT").price)).toBe("200");
    expect(String(quote.netAmount)).toBe("300");
  });

  test("a quote raised at a collection centre carries the centre's number", async ({ loginAs, users }) => {
    const name = uid("Quoted");
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await chooseOption(tech, "Branch or centre", BASELINE.centre.name);
    await addItem(tech, "CBC");
    await saveQuote(tech);
    await expect(quoteSheet(tech)).toContainText(BASELINE.centre.name);
    const quote = await db().quotation.findFirst({ where: { patientName: name } });
    expect(quote.quoteNumber).toMatch(new RegExp(`^Q${billPrefix(BASELINE.centre.locationCode, istDate())}\\d{4}$`));
    await expect(quoteSheet(tech)).toContainText(quote.quoteNumber);
  });

  test("a name alone is enough for a quote; the phone is asked for when it becomes a bill", async ({ loginAs, users }) => {
    const name = uid("Nophone");
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await saveQuote(tech);
    await expect(quoteSheet(tech)).toContainText(name);
    expect((await db().quotation.findFirst({ where: { patientName: name } })).patientPhone).toBeNull();

    await tech.getByRole("button", { name: "Done" }).click();
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await expect(tech.getByLabel("Full name")).toHaveValue(name);
    await expect(tech.getByLabel("Phone", { exact: true })).toHaveValue("");
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(tech.getByText("Enter a 10-digit phone number")).toBeVisible();
    expect(await db().patient.count({ where: { name } })).toBe(0);

    await tech.getByLabel("Phone", { exact: true }).fill(phone());
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("link", { name })).toBeVisible();
  });

  test("a profile quoted with one of its own tests is flagged before it's saved", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "LIPID");
    await addItem(tech, "CHOL");
    await expect(tech.getByText("CHOL is billed twice: in LIPID and CHOL.")).toBeVisible();
    await tech.getByRole("row", { name: /^CHOL/ }).getByRole("button", { name: "Remove" }).click();
    await expect(tech.getByText(/is billed twice/)).toHaveCount(0);
    await expect(figure(tech, "Net amount")).toContainText("₹250.00");
  });

  test("a quote discounted to nothing converts into a paid bill whose discount still needs approval", async ({ loginAs, users }) => {
    const name = uid("Free");
    const tech = await loginAs(users.tech1);
    await tech.goto("/quotations/new");
    await tech.getByLabel("Name", { exact: true }).fill(name);
    await tech.getByLabel(/^Phone/).fill(phone());
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("100");
    await expect(figure(tech, "Net amount")).toContainText("₹0.00");
    await saveQuote(tech);
    await expect(quoteSheet(tech)).toContainText("₹0.00");
    await tech.getByRole("button", { name: "Done" }).click();
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
    await expect(tech.getByRole("main")).toContainText("StatusPaid");
    await expect(tech.getByText(/Discount awaiting approval/)).toBeVisible();
    await expect(tech.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  });
});

test.describe("From quote to bill", () => {
  test("the quote's place, referral, payer, items and discount can't be changed while converting", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["CBC", "GLUF"], discountAmount: 20, referralType: "doctor", referringDoctorId: (await baseline.doctor()).id });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await expect(tech.getByRole("alert").first()).toContainText(`Converting quotation ${quote.quoteNumber}`);
    await expect(tech.getByLabel("Branch or centre", { exact: true })).toBeDisabled();
    for (const radio of ["At the location", "Home visit", "Walk-in", "Doctor", "Self", "Panel"]) {
      await expect(tech.getByRole("radio", { name: radio, exact: true })).toBeDisabled();
    }
    await expect(tech.getByRole("combobox", { name: /^Referring doctor/ })).toBeDisabled();
    await expect(tech.getByRole("spinbutton", { name: /^Discount/ })).toBeDisabled();
    await expect(tech.getByRole("spinbutton", { name: /^Discount/ })).toHaveValue("20");
    await expect(tech.getByLabel("Add a test, profile or service")).toHaveCount(0);
    await expect(tech.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(tech.getByLabel("Bill date")).toHaveCount(0); // a converted quote is billed today
    await expect(figure(tech, "Net amount")).toContainText("₹380.00");
  });

  test("a camp quote keeps its camp prices inside 48 hours, even after the camp has ended", async ({ loginAs, users, leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const camp = await addCamp(leadApi, panel, { startsIn: -5, endsIn: 5, discountPercent: 20 });
    const quote = await techApi.createQuote({ items: ["CBC"], payerType: "panel", panelId: panel.id, campId: camp.id, locationId: undefined });
    // The quote was issued two hours ago, and the camp ended an hour ago.
    await expireQuote(quote.id, 2);
    await db().camp.update({ where: { id: camp.id }, data: { endsAt: new Date(Date.now() - 3600e3) } });

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("main")).toContainText(`camp ${camp.name}`);
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await expect(figure(tech, "Net amount")).toContainText("₹240.00"); // 20% off 300
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹240.00");
    await expect(tech.getByRole("main")).toContainText(`camp ${camp.name}`);
  });

  test("a quote's doctor rejected by the lead: the quote and its bill go ahead without the doctor's name", async ({ loginAs, users, leadApi, techApi }) => {
    const { doctor } = await techApi.call("POST", "/doctors", { name: uid("Dr Quoted") });
    const quote = await techApi.createQuote({ items: ["GLUF"], referralType: "doctor", referringDoctorId: doctor.id });
    const approval = await techApi.approvalFor({ subjectId: doctor.id, subjectType: "referring_doctor" });
    await leadApi.decide(approval.id, "reject", "Not a real doctor");

    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("main")).not.toContainText(doctor.name);
    await tech.getByRole("button", { name: "Convert to bill" }).click();
    await fillNewPatient(tech);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Doctor (not named)");
    await expect(tech.getByText(/Referring doctor awaiting approval/)).toHaveCount(0);
  });

  test("a quote for a panel that has since been removed says why it can't convert", async ({ loginAs, users, leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const quote = await techApi.createQuote({ items: ["GLUF"], payerType: "panel", panelId: panel.id });
    await leadApi.call("DELETE", `/panels/${panel.id}`);
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    await expect(tech.getByRole("alert")).toContainText("Select a valid panel.");
    await expect(tech.getByRole("button", { name: "Convert to bill" })).toHaveCount(0);
  });

  test("the quote runs out, with a new price, while its bill is being filled in: nothing is billed", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const quote = await techApi.createQuote({ items: [item.code] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await fillNewPatient(tech);

    await expireQuote(quote.id);
    await setPrice(leadApi, item, 160);
    await createBill(tech);
    await expect(tech.getByText(/has expired and its prices have changed: re-issue it/).first()).toBeVisible();
    await expect(tech.getByRole("heading", { name: `Bill quotation ${quote.quoteNumber}` })).toBeVisible();
    expect(await db().bill.count({ where: { quotationId: quote.id } })).toBe(0);
  });

  test("the quote is cancelled at another desk while its bill is being filled in: nothing is billed", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?quotation=${quote.id}`);
    await fillNewPatient(tech);
    await techApi.call("POST", `/quotations/${quote.id}/cancel`);
    await createBill(tech);
    await expect(tech.getByText(`Quotation ${quote.quoteNumber} is cancelled.`).first()).toBeVisible();
    expect(await db().bill.count({ where: { quotationId: quote.id } })).toBe(0);
  });
});

test.describe("Printing a quotation again", () => {
  test("Print on the quote page opens the same sheet; an expired quote's sheet still shows when it ran out", async ({ loginAs, users, techApi }) => {
    const quote = await techApi.createQuote({ items: ["LIPID"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/quotations/${quote.id}`);
    const [popup] = await Promise.all([tech.waitForEvent("popup"), tech.getByRole("button", { name: "Print", exact: true }).click()]);
    const sheet = popup.getByRole("main", { name: `Quotation ${quote.quoteNumber}` });
    for (const text of [quote.patientName, quote.patientPhone, "Includes: Cholesterol, Triglycerides", "₹250.00", quote.verificationCode]) {
      await expect(sheet).toContainText(text);
    }
    await expect(popup.getByRole("button", { name: "Close" })).toBeVisible(); // its own tab: nothing to go back to

    await expireQuote(quote.id, 72);
    const fresh = await db().quotation.findUnique({ where: { id: quote.id } });
    await tech.goto(`/print/quotation/${quote.id}`);
    const until = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).format(fresh.validUntil);
    await expect(quoteSheet(tech)).toContainText(`Valid for 48 hours, until ${until}`);
  });
});
