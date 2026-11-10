// The technician's billing journey through the screens, beyond the first
// happy paths: where the bill is raised, who pays, how the patient is
// entered, what the pickers stop offering, and what a bill looks like once
// it is paid, discounted, cancelled in part, or interrupted on the way.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, phone, istDate, billPrefix } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");
const { figure, billHeading, createBill, section, holdNotice, pick, dmy, fillPicker, addCatalogItem, retire, addCamp, decide, fillNewPatient } = require("../../helpers/flows");

// A new bill for an already-registered patient, at the baseline branch.
async function newBillFor(page, patient, place = BASELINE.branch.name) {
  await page.goto(`/bills/new?patient=${patient.id}`);
  await chooseOption(page, "Branch or centre", place);
}

const money = (page) => section(page, "Payments and refunds");

test.describe("Where and for whom", () => {
  test("a bill raised at a collection centre carries the centre's number and name", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient, BASELINE.centre.name);
    await addItem(tech, "CBC");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    const bill = await db().bill.findFirst({ where: { patientId: patient.id } });
    expect(bill.billNumber).toMatch(new RegExp(`^${billPrefix(BASELINE.centre.locationCode, istDate())}\\d{4}$`));
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(BASELINE.centre.name);
  });

  test("choosing a running camp applies its prices and fixes the bill to the camp's place", async ({ loginAs, users, leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const cbc = await baseline.item("CBC");
    const camp = await addCamp(leadApi, panel, { discountPercent: 10, items: [{ catalogItemId: cbc.id, price: 199 }] });
    const patient = await techApi.registerPatient();

    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient, BASELINE.noVisitBranch.name);
    await addItem(tech, "CBC");
    await addItem(tech, "GLUF");
    await tech.getByRole("radio", { name: "Panel" }).check();
    await pick(tech, "Panel", panel.name);
    await expect(figure(tech, "Net amount")).toContainText("₹400.00"); // the panel has no rates of its own
    await tech.getByRole("combobox", { name: /^Camp/ }).click();
    await tech.locator(".ant-select-dropdown:visible").getByTitle(camp.name, { exact: true }).click();
    // CBC at the camp's own price, GLUF at 10% off; the place is now the camp's.
    await expect(figure(tech, "Net amount")).toContainText("₹289.00");
    await expect(tech.getByLabel("Branch or centre", { exact: true })).toBeDisabled();
    await expect(tech.getByText("A camp's orders use the camp's location.")).toBeVisible();
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    const main = tech.getByRole("main");
    await expect(main).toContainText(`${panel.name} · camp ${camp.name}`);
    await expect(main).toContainText(BASELINE.branch.name);
    await expect(figure(tech, "Net amount")).toContainText("₹289.00");
  });

  test("a doctor still awaiting approval holds the bill's report until the lead approves them", async ({ loginAs, users, techApi }) => {
    const { doctor } = await techApi.call("POST", "/doctors", { name: uid("Dr Pending") });
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await tech.getByRole("radio", { name: "Doctor" }).check();
    await pick(tech, "Referring doctor", `${doctor.name} (awaiting approval)`);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(holdNotice(tech)).toContainText("Referring doctor awaiting approval");

    const lead = await loginAs(users.lead);
    await decide(lead, doctor.name, "approve");
    await tech.reload();
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByText("Report on hold")).toHaveCount(0);
    await expect(tech.getByRole("main")).toContainText(`Doctor: ${doctor.name}`);
  });
});

test.describe("What the pickers stop offering", () => {
  test("a retired test can't be found in the search, and typing its code names it as unknown", async ({ loginAs, users, leadApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    await retire(leadApi, item);
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    const search = tech.getByLabel("Add a test, profile or service");
    await search.click();
    await search.fill(item.code);
    await expect(tech.locator(`.ant-select-dropdown:visible [title^="${item.code} · "]`)).toHaveCount(0);
    await search.fill(`${item.code} GLUF`);
    await search.press("Enter");
    await expect(tech.getByText(`Not in the catalog: ${item.code}`)).toBeVisible();
    await expect(tech.getByRole("row", { name: /^GLUF Glucose fasting/ })).toBeVisible();
    await expect(tech.getByRole("group", { name: "Most used tests and services" }).getByRole("button", { name: new RegExp(`^${item.code}`) })).toHaveCount(0);
  });

  test("a test retired while the bill is being filled in stops the bill, naming the problem", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, item.code);
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await retire(leadApi, item);
    await createBill(tech);
    await expect(tech.getByText(/aren't in the active catalog/).first()).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);
  });

  test("a removed branch and a removed panel are gone from a new bill's pickers", async ({ loginAs, users, leadApi }) => {
    const [loc, panel] = [await leadApi.addLocation(), await leadApi.addPanel()];
    await leadApi.call("DELETE", `/locations/${loc.id}`);
    await leadApi.call("DELETE", `/panels/${panel.id}`);
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    const place = tech.getByLabel("Branch or centre", { exact: true });
    await place.click();
    await place.fill(loc.name);
    await expect(tech.locator(".ant-select-dropdown:visible").getByTitle(loc.name, { exact: true })).toHaveCount(0);
    await place.press("Escape");
    await tech.getByRole("radio", { name: "Panel" }).check();
    const panels = tech.getByRole("combobox", { name: /^Panel/ });
    await panels.click();
    await panels.fill(panel.name);
    await expect(tech.locator(".ant-select-dropdown:visible").getByTitle(panel.name, { exact: true })).toHaveCount(0);
  });
});

test.describe("Entering the patient", () => {
  test("a new patient by date of birth: the bill shows their exact age", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Dob"), phone()];
    const year = Number(istDate().slice(0, 4)) - 30;
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByLabel("Full name").fill(name);
    await tech.getByLabel("Phone", { exact: true }).fill(ph);
    await tech.getByLabel("Male", { exact: true }).check();
    await tech.getByLabel("Date of birth", { exact: true }).check();
    await expect(tech.getByLabel("Age (years)")).toHaveCount(0);
    await fillPicker(tech.getByRole("textbox", { name: "Date of birth" }), `01/01/${year}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("30 y · M");
    const patient = await db().patient.findFirst({ where: { phone: ph } });
    expect(patient.dobIsApproximate).toBe(false);
    expect(patient.dateOfBirth.toISOString().slice(0, 10)).toBe(`${year}-01-01`);
  });

  test("a date of birth in the future isn't accepted", async ({ loginAs, users }) => {
    const ph = phone();
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByLabel("Full name").fill(uid("Future"));
    await tech.getByLabel("Phone", { exact: true }).fill(ph);
    await tech.getByLabel("Female", { exact: true }).check();
    await tech.getByLabel("Date of birth", { exact: true }).check();
    const tomorrow = dmy(istDate(new Date(Date.now() + 2 * 86400e3)));
    await fillPicker(tech.getByRole("textbox", { name: "Date of birth" }), tomorrow);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await createBill(tech);
    await expect(tech.getByText("Enter the date of birth")).toBeVisible();
    expect(await db().patient.count({ where: { phone: ph } })).toBe(0);
  });

  test("a newborn is billed at age 0", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Baby"), phone()];
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await fillNewPatient(tech, { name, phone: ph, age: 0, sex: "Other" });
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("0 y · O");
  });

  test("a phone typed with +91 and spaces is stored as its ten digits", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Spaced"), phone()];
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await fillNewPatient(tech, { name, phone: `+91 ${ph.slice(0, 5)} ${ph.slice(5)}` });
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(`Phone${ph}`);
    expect((await db().patient.findFirst({ where: { name } })).phone).toBe(ph);
  });

  test("a phone that is too short is caught in the form", async ({ loginAs, users }) => {
    const name = uid("Short");
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await fillNewPatient(tech, { name, phone: "98765" });
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await createBill(tech);
    await expect(tech.getByText("Enter a 10-digit phone number")).toBeVisible();
    expect(await db().patient.count({ where: { name } })).toBe(0);
  });

  test("typing a registered patient's exact details again bills that patient: no duplicate", async ({ loginAs, users, techApi }) => {
    const existing = await techApi.registerPatient({ sex: "male", ageYears: 44 });
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    // In another case, with extra spaces: still the same person.
    await fillNewPatient(tech, { name: `  ${existing.name.toUpperCase()} `, phone: existing.phone, age: 44, sex: "Male" });
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await createBill(tech);
    await expect(tech.getByText(new RegExp(`was already registered \\(${existing.patientNumber}\\)`))).toBeVisible();
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(existing.patientNumber);
    expect(await db().patient.count({ where: { phone: existing.phone } })).toBe(1);
    expect(await db().bill.count({ where: { patientId: existing.id } })).toBe(1);
  });
});

test.describe("Paid, discounted, cancelled", () => {
  test("paid in full when it's created: the bill is Paid, with nothing left to collect", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await tech.getByLabel("Paid now").fill("300");
    await chooseOption(tech, "Payment mode", "UPI");
    await expect(figure(tech, "Balance after payment")).toContainText("₹0.00");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("StatusPaid");
    await expect(tech.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    const payment = money(tech).getByRole("row", { name: /Payment/ });
    await expect(payment).toContainText("₹300.00");
    await expect(payment).toContainText("UPI");
    await expect(payment).toContainText(users.tech1.name);
    await expect(tech.getByText("Report on hold")).toHaveCount(0);
  });

  test("nothing paid when it's created: the full amount is due and no payment is listed", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("StatusBalance due");
    await expect(figure(tech, "Balance")).toContainText("₹300.00");
    await expect(money(tech)).toContainText("Nothing paid yet");
    await expect(tech.getByRole("button", { name: "Record payment" })).toBeVisible();
  });

  test("a bill discounted to nothing is Paid without a payment, and its report waits for approval", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("300");
    await expect(figure(tech, "Net amount")).toContainText("₹0.00");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("StatusPaid");
    await expect(figure(tech, "Discount")).toContainText("₹300.00");
    await expect(holdNotice(tech)).toContainText("Discount awaiting approval");
    await expect(tech.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await expect(tech.getByRole("row", { name: /Discount: ₹0\.00 → ₹300\.00/ })).toContainText("Pending");
  });

  test("a refund in another mode than the payment: both are listed with their own modes", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "credit_card" } });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Cancel tests" }).click();
    const dialog = tech.getByRole("dialog", { name: "Cancel tests" });
    await dialog.getByLabel(/^GLUF/).check();
    await dialog.getByLabel("Reason").fill("Not fasting");
    await chooseOption(tech, "Refund mode", "Cash", dialog);
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog).toBeHidden();
    const payment = money(tech).getByRole("row", { name: /Payment/ });
    await expect(payment).toContainText("Card");
    await expect(payment).toContainText("₹400.00");
    const refund = money(tech).getByRole("row", { name: /Refund/ });
    await expect(refund).toContainText("Cash");
    await expect(refund).toContainText("-₹100.00");
    await expect(refund).toContainText("Not fasting");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
  });

  test("the print of a partly cancelled bill strikes the cancelled test and shows the refund", async ({ loginAs, users, techApi }) => {
    const created = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    await techApi.cancel(created, ["GLUF"], { refundMode: "cash" });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/print/bill/${created.id}`);
    const sheet = tech.getByRole("main", { name: `Bill ${created.billNumber}` });
    await expect(sheet).toContainText("Glucose fasting (cancelled)");
    await expect(sheet.locator("tr.cancelled")).toHaveCount(1);
    const totals = sheet.locator(".print-totals");
    await expect(totals.getByRole("row", { name: /Net amount/ })).toContainText("₹300.00");
    await expect(totals.getByRole("row", { name: /Paid \(Cash\)/ })).toContainText("₹400.00");
    await expect(totals.getByRole("row", { name: /Refunded/ })).toContainText("-₹100.00");
    await expect(totals.getByRole("row", { name: /Balance due/ })).toContainText("₹0.00");
    await expect(sheet).not.toContainText("hold"); // internal; never printed
  });

  test("a bill for a service alone has no samples to record", async ({ loginAs, users, leadApi, techApi }) => {
    const service = await addCatalogItem(leadApi, { kind: "service", price: 80, name: "E2E Report copy" });
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, service.code);
    await expect(figure(tech, "Net amount")).toContainText("₹80.00");
    await expect(tech.getByRole("heading", { name: "Samples" })).toHaveCount(0);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("heading", { name: "Samples" })).toHaveCount(0);
    await expect(tech.getByRole("row", { name: new RegExp(`^${service.code}`) })).toContainText("Service");
  });
});

test.describe("When creating the bill is interrupted", () => {
  test("the server fails once: the form keeps everything, and trying again makes one bill", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    await tech.getByLabel("Paid now").fill("120");
    let failed = false;
    await tech.route("**/api/bills", async (route) => {
      if (route.request().method() === "POST" && !failed) {
        failed = true;
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong. Please try again." }) });
      }
      return route.fallback();
    });
    await createBill(tech);
    await expect(tech.getByText("Something went wrong. Please try again.").first()).toBeVisible();
    await expect(tech.getByRole("heading", { name: "New bill" })).toBeVisible();
    await expect(tech.getByLabel("Paid now")).toHaveValue("120");
    await expect(tech.getByRole("row", { name: /^CBC Complete blood count/ })).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);

    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹180.00");
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(1);
  });

  test("Create bill pressed before the prices have come back: a payment isn't called 'more than the net amount'", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    // A slow server (or a fast typist): the prices take two seconds.
    await tech.route("**/api/bills/preview", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fallback();
    });
    await addItem(tech, "CBC");
    await tech.getByLabel("Paid now").fill("300");
    await createBill(tech);
    await expect(tech.getByText("More than the net amount")).toHaveCount(0);
    // Once the prices are in, the same payment goes through.
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    if (!(await billHeading(tech).isVisible())) await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
  });

  test("the session has ended by the time Create bill is pressed: back to sign-in, and nothing is billed", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
    await tech.context().clearCookies();
    await createBill(tech);
    await expect(tech).toHaveURL(/\/login/);
    await expect(tech.getByLabel("Password")).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);
  });

  test("going Back after a bill is created doesn't create it again", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await tech.goBack();
    await expect(tech.getByRole("heading", { name: "New bill" })).toBeVisible();
    await expect(tech.getByText("No items yet")).toBeVisible(); // a fresh form, not the old order
    await tech.goForward();
    await expect(billHeading(tech)).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(1);
  });
});
