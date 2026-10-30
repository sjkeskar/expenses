// Step 4 screens: patients, new bill, bill detail, revisits, day sheet,
// panel settlement, panels & camps, verify, and the A4 prints.
const { test, expect } = require("../../fixtures");
const { baseline, createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { uid, phone, istDate } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");

// "DD/MM/YYYY hh:mm AM" for a time `hours` from now, as the date pickers
// take it (12-hour, with AM/PM).
function pickerTime(hours) {
  const d = new Date(Date.now() + hours * 3600e3);
  const [y, m, day] = istDate(d).split("-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  return `${day}/${m}/${y} ${time}`;
}

// A labelled figure (components/Page.tsx Figures), e.g. "Net amount".
const figure = (page, label) => page.getByRole("group", { name: label, exact: true });

test.describe("Patients", () => {
  test("register a patient; a look-alike is shown first and can be confirmed as someone else", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Pat"), phone()];
    const tech = await loginAs(users.tech1);
    const register = async (who) => {
      await tech.goto("/patients");
      await tech.getByRole("main").getByRole("button", { name: "Register patient" }).click();
      const dialog = tech.getByRole("dialog", { name: "Register patient" });
      await dialog.getByLabel("Full name").fill(who);
      await dialog.getByLabel("Age (years)").fill("40");
      await dialog.getByLabel("Female").check();
      await dialog.getByLabel("Phone").fill(ph);
      await dialog.getByRole("button", { name: "Register" }).click();
      return dialog;
    };
    await register(name);
    await expect(tech.getByRole("heading", { name })).toBeVisible();

    const dialog = await register(`${name} Twin`);
    await expect(dialog.getByRole("alert").first()).toHaveText("This may be a patient who is already registered.");
    await expect(dialog.getByText(new RegExp(`^${name} · Female`))).toBeVisible();
    await dialog.getByRole("button", { name: "Different person" }).click();
    await expect(tech.getByRole("heading", { name: `${name} Twin` })).toBeVisible();
  });

  test("a technician's correction waits; once approved the patient shows it, with the old number kept", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/patients/${patient.id}`);
    await tech.getByRole("button", { name: "Propose a correction" }).click();
    const dialog = tech.getByRole("dialog", { name: "Propose a correction" });
    await dialog.getByLabel("Full name").fill(`${patient.name} Corrected`);
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(tech.getByText("A correction is waiting for a pathologist's approval")).toBeVisible();
    await expect(tech.getByRole("button", { name: "Propose a correction" })).toBeDisabled();

    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    const row = path.getByRole("row", { name: new RegExp(patient.patientNumber) });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await path.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
    await expect(row).toBeHidden();

    await tech.reload();
    await expect(tech.getByRole("heading", { name: `${patient.name} Corrected` })).toBeVisible();
    await expect(tech.getByText(patient.patientNumber)).toBeVisible(); // under "Old numbers"
  });
});

test.describe("Billing", () => {
  test("a new bill: overlap warning, live prices, a draw left for a revisit, a payment", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    for (const c of ["LIPID", "CHOL", "GTT"]) await addItem(tech, c);
    await expect(tech.getByText("CHOL is billed twice: in LIPID and CHOL.")).toBeVisible();
    await expect(figure(tech, "Net amount")).toContainText("₹900.00");

    await tech.getByLabel("GTT 2 h collected now").click();
    const due = tech.getByLabel("GTT 2 h due back");
    const when = pickerTime(24);
    await due.fill(when);
    await due.press("Enter");
    await expect(due).toHaveValue(when);
    expect(when).toMatch(/ (AM|PM)$/);
    await tech.getByLabel("Paid now").fill("400");
    await expect(figure(tech, "Balance after payment")).toContainText("₹500.00");
    await tech.getByRole("button", { name: "Create bill" }).last().click();

    await expect(tech.getByRole("heading", { name: /^Bill \d+/ })).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹500.00");
    const later = tech.getByRole("row", { name: /GTT · Glucose tolerance 2 h/ });
    await expect(later).toContainText("Pending");

    await expect(later).toContainText(when); // shown the way it was entered
    await tech.getByLabel("Select GTT 2 h").check();
    await tech.getByRole("button", { name: "Record collection" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(later).toContainText("Collected");

    await tech.getByRole("button", { name: "Record payment" }).click();
    const dialog = tech.getByRole("dialog", { name: "Record payment" });
    await expect(dialog.getByLabel("Amount")).toHaveValue("500");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
    await expect(tech.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  });

  test("a new bill opens on a new patient's fields; the patient is registered with the bill", async ({ loginAs, users }) => {
    const [name, ph] = [uid("Walkin"), phone()];
    const tech = await loginAs(users.tech1);
    await tech.keyboard.press("Alt+B");
    await expect(tech.getByRole("heading", { name: "New bill" })).toBeVisible();
    await expect(tech.getByLabel("Full name")).toBeFocused();
    await tech.keyboard.type(name);
    await tech.getByLabel("Phone", { exact: true }).fill(ph);
    await tech.getByLabel("Age (years)").fill("41");
    await tech.getByLabel("Female").check();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await tech.getByRole("button", { name: "Create bill" }).last().click();
    await expect(tech.getByRole("heading", { name: /^Bill \d+/ })).toBeVisible();
    await expect(tech.getByRole("link", { name })).toBeVisible();
    expect(await db().patient.count({ where: { phone: ph } })).toBe(1);
  });

  test("Tab goes from the payment straight to the Create bill button at the end of the form", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByLabel("Payment mode").focus();
    await tech.keyboard.press("Tab");
    await expect(tech.getByRole("button", { name: "Create bill" }).last()).toBeFocused();
    await expect(tech.getByRole("button", { name: "Create bill" })).toHaveCount(2); // the one at the top stays
  });

  test("a returning patient is searched for; a search that finds no one carries the typed phone back to new", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByRole("button", { name: "Returning patient? Search registered patients" }).click();
    await expect(tech.getByLabel("Patient", { exact: true })).toBeFocused();
    await tech.keyboard.type(patient.phone);
    await tech.locator(".ant-select-dropdown:visible").getByTitle(new RegExp(`^${patient.name} · `)).click();
    await expect(tech.getByText(patient.patientNumber)).toBeVisible();

    const ph = phone();
    await tech.getByLabel("Patient", { exact: true }).fill(ph);
    await tech.locator(".ant-select-dropdown:visible").getByTitle(`+ New patient: ${ph}`).click();
    await expect(tech.getByLabel("Phone", { exact: true })).toHaveValue(ph);
    await expect(tech.getByLabel("Full name")).toHaveValue("");
  });

  test("a look-alike stops the bill at the patient; 'Different person' carries on with the rest kept", async ({ loginAs, users, techApi }) => {
    const twin = await techApi.registerPatient({ sex: "female", ageYears: 40 });
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByLabel("Full name").fill(`${twin.name} Two`);
    await tech.getByLabel("Phone", { exact: true }).fill(twin.phone);
    await tech.getByLabel("Age (years)").fill("40");
    await tech.getByLabel("Female").check();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "GLUF");
    await tech.getByRole("button", { name: "Create bill" }).last().click();
    await expect(tech.getByText("This may be a patient who is already registered.")).toBeVisible();
    await expect(tech.getByText(new RegExp(`^${twin.name} · Female`))).toBeVisible();
    await expect(tech.getByRole("row", { name: /^GLUF Glucose fasting/ })).toBeVisible(); // the bill is still filled in
    await tech.getByRole("button", { name: "Different person" }).click();
    await expect(tech.getByRole("heading", { name: /^Bill \d+/ })).toBeVisible();
    await expect(tech.getByRole("link", { name: `${twin.name} Two` })).toBeVisible();
  });

  test("a look-alike can be picked instead", async ({ loginAs, users, techApi }) => {
    const twin = await techApi.registerPatient({ sex: "male", ageYears: 50 });
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await tech.getByLabel("Full name").fill(`${twin.name}x`);
    await tech.getByLabel("Phone", { exact: true }).fill(twin.phone);
    await tech.getByLabel("Age (years)").fill("51");
    await tech.getByLabel("Male", { exact: true }).check();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await tech.getByRole("button", { name: "Create bill" }).last().click();
    await tech.getByRole("button", { name: "Use this patient" }).click();
    await expect(tech.getByText(twin.patientNumber)).toBeVisible(); // now the chosen patient
    await expect(tech.getByLabel("Full name")).toHaveCount(0);
  });

  test("the most-used tiles add and remove items, and flag a test a chosen profile already covers", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    const tiles = tech.getByRole("group", { name: "Most used tests and services" });
    const cbc = tiles.getByRole("button", { name: /^CBC/ });
    await cbc.click();
    await expect(cbc).toHaveAttribute("aria-pressed", "true");
    await expect(tech.getByRole("row", { name: /^CBC Complete blood count/ })).toBeVisible();
    await cbc.click();
    await expect(cbc).toHaveAttribute("aria-pressed", "false");
    await expect(tech.getByRole("row", { name: /^CBC Complete blood count/ })).toHaveCount(0);

    await tiles.getByRole("button", { name: /^LIPID/ }).click();
    await expect(tiles.getByRole("button", { name: /^CHOL/ })).toContainText("in LIPID");
  });

  test("several codes typed at once are all added; unknown ones are named", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    const search = tech.getByLabel("Add a test, profile or service");
    await search.click();
    await search.fill("cbc, gluf NOSUCH");
    await search.press("Enter");
    await expect(tech.getByRole("row", { name: /^CBC Complete blood count/ })).toBeVisible();
    await expect(tech.getByRole("row", { name: /^GLUF Glucose fasting/ })).toBeVisible();
    await expect(tech.getByText("Not in the catalog: NOSUCH")).toBeVisible();
    await expect(search).toHaveValue("");
  });

  test("home visits are only offered where the location has a charge", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills/new");
    await chooseOption(tech, "Branch or centre", BASELINE.noVisitBranch.name);
    await expect(tech.getByLabel("Home visit")).toBeDisabled();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await tech.getByLabel("Home visit").check();
    await expect(tech.getByLabel("Home-visit charge")).toHaveValue("200");
    await addItem(tech, "CBC");
    await expect(tech.getByRole("row", { name: /HOMEVISIT/ })).toContainText("₹200.00");
  });

  test("cancelling a test refunds the difference and holds the report; a discount change too", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Cancel tests" }).click();
    const dialog = tech.getByRole("dialog", { name: "Cancel tests" });
    await dialog.getByLabel(/^GLUF/).check();
    await dialog.getByLabel("Reason").fill("Doctor changed the order");
    await expect(dialog).toContainText("About ₹100.00 is refunded to the patient.");
    await chooseOption(tech, "Refund mode", "Cash", dialog);
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog).toBeHidden();
    await expect(tech.getByText(/Cancellation awaiting approval/)).toBeVisible();
    await expect(tech.getByRole("row", { name: /Refund/ })).toContainText("-₹100.00");
    await expect(tech.getByRole("row", { name: /^GLUF/ })).toContainText("Cancelled");

    await tech.getByRole("button", { name: "Change discount" }).click();
    const discount = tech.getByRole("dialog", { name: "Change discount" });
    await expect(discount).toContainText("₹300.00"); // the subtotal after cancelling
    await expect(discount.getByRole("button", { name: "Save" })).toBeVisible();
    await discount.getByRole("button", { name: "Cancel" }).click();
  });

  test("a revisit due today is listed, overdue, and recorded with one click", async ({ loginAs, users, techApi }) => {
    const gtt = await baseline.item("GTT");
    const bill = await techApi.createBill({
      items: ["GTT"],
      pendingDraws: [{ catalogItemId: gtt.id, testId: gtt.id, sequence: 3, dueAt: new Date(Date.now() - 60e3).toISOString() }],
    });
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Sample revisits" }).click();
    const row = tech.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toContainText("Overdue");
    await expect(row).toContainText("2 h");
    await row.getByRole("button", { name: "Mark collected" }).click();
    // Nothing is recorded until it's confirmed.
    const confirm = tech.getByRole("tooltip");
    await expect(confirm).toContainText(`Mark GTT (2 h) collected?`);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Mark collected" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(row).toBeHidden();
  });

  test("the day sheet: totals by mode, and the lead opens anyone's", async ({ loginAs, users }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      const bill = await client.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "upi" } });
      const page = await loginAs(tech);
      await page.getByRole("menuitem", { name: "Day sheet" }).click();
      await expect(figure(page, "UPI")).toContainText("₹300.00");
      await expect(figure(page, "Total to hand over")).toContainText("₹300.00");
      await expect(page.getByRole("row", { name: new RegExp(bill.billNumber) })).toHaveCount(2); // money taken + bills created

      const lead = await loginAs(users.lead);
      await lead.goto("/daysheet");
      await chooseOption(lead, "Whose day sheet", `${tech.name} (Technician)`);
      await expect(figure(lead, "Total to hand over")).toContainText("₹300.00");
    } finally {
      await client.dispose();
    }
  });

  test("panel settlement closes the ticked bills only", async ({ loginAs, users, leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const [a, b] = [await techApi.createBill({ payerType: "panel", panelId: panel.id }), await techApi.createBill({ payerType: "panel", panelId: panel.id, items: ["GLUF"] })];
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Panel settlement" }).click();
    await chooseOption(tech, "Panel", panel.name);
    await tech.getByRole("row", { name: new RegExp(a.billNumber) }).getByRole("checkbox").check();
    await expect(tech.getByText("Selected: 1 bill, ₹300.00")).toBeVisible();
    await tech.getByRole("button", { name: "Settle 1 bill" }).click();
    await expect(tech.getByText("1 bill settled for ₹300.00.")).toBeVisible();
    await expect(tech.getByRole("row", { name: new RegExp(a.billNumber) })).toHaveCount(0);
    await expect(tech.getByRole("row", { name: new RegExp(b.billNumber) })).toBeVisible();
  });

  test("a bill's code verifies on the Verify screen", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill();
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Verify document" }).click();
    await tech.getByLabel("Verification code").fill(bill.verificationCode);
    await tech.getByLabel("Verification code").press("Enter");
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await tech.getByLabel("Verification code").fill("NOTAREALCODE");
    await tech.getByLabel("Verification code").press("Enter");
    await expect(tech.getByText("Not a document from this lab")).toBeVisible();
  });
});

test.describe("Panels & camps", () => {
  test("the lead adds a panel with standing rates, and a camp", async ({ loginAs, users }) => {
    const [panel, camp] = [uid("Panel"), uid("Camp")];
    const lead = await loginAs(users.lead);
    await lead.getByRole("menuitem", { name: "Panels & camps" }).click();
    await lead.getByRole("button", { name: "Add panel" }).click();
    let dialog = lead.getByRole("dialog", { name: "Add panel" });
    await dialog.getByLabel("Name").fill(panel);
    await dialog.getByLabel("TPA").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    const row = lead.getByRole("row", { name: new RegExp(panel) });
    await expect(row).toContainText("Catalog prices");

    await row.getByRole("button", { name: "Rates" }).click();
    dialog = lead.getByRole("dialog", { name: `${panel}: standing rates` });
    await dialog.getByLabel("Discount on catalog prices (%)").fill("10");
    await dialog.getByRole("button", { name: "Add a custom price" }).click();
    await chooseOption(lead, "Item 1", "CBC · Complete blood count (₹300.00)", dialog);
    await dialog.getByLabel("Price 1").fill("199");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("10% off · 1 custom price");

    await lead.getByRole("button", { name: "Add camp" }).click();
    dialog = lead.getByRole("dialog", { name: "Add camp" });
    await chooseOption(lead, "Panel (the company)", panel, dialog);
    await dialog.getByLabel("Camp name").fill(camp);
    await chooseOption(lead, "Conducted by", BASELINE.branch.name, dialog);
    await dialog.getByLabel("Discount on catalog prices (%)").fill("20");
    await dialog.getByPlaceholder("Start date").click();
    await dialog.getByPlaceholder("Start date").fill(pickerTime(-1));
    await dialog.getByPlaceholder("Start date").press("Enter");
    await dialog.getByPlaceholder("End date").fill(pickerTime(5));
    // Enter confirms the period and, the form being complete, saves the camp.
    await dialog.getByPlaceholder("End date").press("Enter");
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: new RegExp(camp) })).toContainText("Running");
    await expect(lead.getByRole("row", { name: new RegExp(camp) })).toContainText("20% off");
  });
});

test.describe("A4 prints", () => {
  test("the bill print carries the patient number, totals, pending visits and the verification code", async ({ loginAs, users, techApi }) => {
    const gtt = await baseline.item("GTT");
    const bill = await techApi.createBill({
      items: ["LIPID", "GTT"],
      initialPayment: { amount: 100, mode: "cash" },
      pendingDraws: [{ catalogItemId: gtt.id, testId: gtt.id, sequence: 2, dueAt: new Date(Date.now() + 3600e3).toISOString() }],
      expectedReportAt: new Date(Date.now() + 86400e3).toISOString(),
    });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/print/bill/${bill.id}`);
    const sheet = tech.getByRole("main", { name: `Bill ${bill.billNumber}` });
    for (const text of [BASELINE.settings.labName, BASELINE.branch.name, bill.patient.patientNumber, "Includes: Cholesterol, Triglycerides", "Report expected by", "Samples still to give", "Glucose tolerance (1 h)", "₹650.00", bill.verificationCode]) {
      await expect(sheet).toContainText(text);
    }
    await expect(sheet).not.toContainText("hold");
    await expect.poll(() => tech.evaluate(() => window.__printed)).toBe(1);
  });

  test("day sheet and revisit prints", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    const me = await db().user.findUnique({ where: { name: users.tech1.name } });
    await tech.goto(`/print/day-sheet?date=${istDate()}&userId=${me.id}`);
    await expect(tech.getByRole("main")).toContainText("Total to hand over");
    await tech.goto("/print/revisits");
    await expect(tech.getByRole("main", { name: "Sample revisits" })).toContainText("All pending");
  });
});
