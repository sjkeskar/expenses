// More bill flows through the screens: payers and referrals on a new bill,
// home visits, validation that stops a bill, and the bill page's dialogs
// (payments, discounts, cancellations, report time, reassignment).
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, phone, istDate } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");

const figure = (page, label) => page.getByRole("group", { name: label, exact: true });
const createBill = (page) => page.getByRole("button", { name: "Create bill" }).last().click();
const billHeading = (page) => page.getByRole("heading", { name: /^Bill \d+/ });

// Picks `option` in the dropdown whose accessible name starts with `name`
// (an optional field's name ends in "(optional)", which chooseOption's exact
// label doesn't match; "Panel" is also a radio button).
async function pick(page, name, option) {
  const box = page.getByRole("combobox", { name: new RegExp(`^${name}`) });
  await box.click();
  await box.fill(option);
  await page.locator(".ant-select-dropdown:visible").getByTitle(option, { exact: true }).click();
}

// A new bill for an already-registered patient, at the baseline branch.
async function newBillFor(page, patient) {
  await page.goto(`/bills/new?patient=${patient.id}`);
  await chooseOption(page, "Branch or centre", BASELINE.branch.name);
}

test.describe("New bill: payer, referral, home visit", () => {
  test("an insurer panel's standing prices replace catalog prices as soon as it's chosen", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await addItem(tech, "GLUF");
    await expect(figure(tech, "Net amount")).toContainText("₹400.00");

    await tech.getByRole("radio", { name: "Panel" }).check();
    await pick(tech, "Panel", BASELINE.insurer);
    // CBC has a custom price (250); GLUF gets the list's 10% off (90).
    await expect(figure(tech, "Net amount")).toContainText("₹340.00");
    await expect(tech.getByRole("row", { name: /^CBC/ }).first()).toContainText("₹250.00");

    // Back to self-pay: catalog prices again, and the panel is cleared.
    await tech.getByRole("radio", { name: "Self" }).check();
    await expect(figure(tech, "Net amount")).toContainText("₹400.00");
    await tech.getByRole("radio", { name: "Panel" }).check();
    await createBill(tech);
    await expect(tech.getByText("Choose the panel")).toBeVisible();

    await pick(tech, "Panel", BASELINE.insurer);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(BASELINE.insurer);
    await expect(figure(tech, "Net amount")).toContainText("₹340.00");
  });

  test("a doctor referral names the doctor on the bill; walk-in clears it", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await tech.getByRole("radio", { name: "Doctor" }).check();
    await pick(tech, "Referring doctor", BASELINE.doctor);
    // Switching to walk-in and back drops the chosen doctor.
    await tech.getByRole("radio", { name: "Walk-in" }).check();
    await tech.getByRole("radio", { name: "Doctor" }).check();
    await expect(tech.getByRole("combobox", { name: /^Referring doctor/ })).toHaveValue("");
    await pick(tech, "Referring doctor", BASELINE.doctor);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(`Doctor: ${BASELINE.doctor}`);
  });

  test("a home visit with a raised charge and an address; moving to a branch without visits drops it", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "CBC");
    await tech.getByLabel("Home visit").check();
    await tech.getByLabel("Home-visit charge").fill("350");
    await tech.getByLabel("Visit address").fill("12 Garden Street");
    await expect(figure(tech, "Net amount")).toContainText("₹650.00");

    await chooseOption(tech, "Branch or centre", BASELINE.noVisitBranch.name);
    await expect(tech.getByLabel("At the location")).toBeChecked();
    await expect(tech.getByLabel("Home-visit charge")).toHaveCount(0);
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");

    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await tech.getByLabel("Home visit").check();
    await expect(tech.getByLabel("Home-visit charge")).toHaveValue("200"); // back to the minimum
    await tech.getByLabel("Home-visit charge").fill("350");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Home visit: 12 Garden Street");
    await expect(tech.getByRole("row", { name: /^HOMEVISIT/ })).toContainText("₹350.00");
  });

  test("a home-visit charge typed below the minimum is never billed below it", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await tech.getByLabel("Home visit").check();
    await tech.getByLabel("Home-visit charge").fill("50");
    await tech.getByLabel("Home-visit charge").blur();
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("row", { name: /^HOMEVISIT/ })).toContainText("₹200.00");
  });
});

test.describe("New bill: what stops it", () => {
  test("no items, then no branch: each is named and nothing is created", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await createBill(tech);
    await expect(tech.getByText("Add at least one test, profile or service")).toBeVisible();
    await expect(tech.getByText("Choose where the patient is seen")).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);
  });

  test("paying more than the net amount is refused in the form", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await tech.getByLabel("Paid now").fill("150");
    await createBill(tech);
    await expect(tech.getByText("More than the net amount")).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);

    await tech.getByLabel("Paid now").fill("100");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
  });

  test("a discount above the subtotal is refused, and the bill isn't created", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await tech.getByRole("spinbutton", { name: /^Discount/ }).fill("500");
    await createBill(tech);
    await expect(tech.getByText(/discount/i).filter({ hasText: /exceed|more than|subtotal|total/i }).first()).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);
  });

  test("a draw left for a revisit needs its due time; part of a profile can wait", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "LIPID");
    await tech.getByLabel("TG Single collected now").click();
    await createBill(tech);
    await expect(tech.getByText("Enter when the patient comes back for TG (Single).")).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(0);

    const due = tech.getByLabel("TG Single due back");
    const d = new Date(Date.now() + 48 * 3600e3);
    const [y, m, day] = istDate(d).split("-");
    await due.fill(`${day}/${m}/${y} 10:00 AM`);
    await due.press("Enter");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("row", { name: /TG · Triglycerides \(in LIPID\)/ })).toContainText("Pending");
    await expect(tech.getByRole("row", { name: /CHOL · Cholesterol \(in LIPID\)/ })).toContainText("Collected");
  });

  test("double-clicking Create bill makes one bill", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await tech.getByRole("button", { name: "Create bill" }).last().dblclick();
    await expect(billHeading(tech)).toBeVisible();
    expect(await db().bill.count({ where: { patientId: patient.id } })).toBe(1);
  });

  test("a bill dated yesterday is listed and printed with yesterday's date", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await newBillFor(tech, patient);
    await addItem(tech, "GLUF");
    const [y, m, d] = istDate(new Date(Date.now() - 24 * 3600e3)).split("-");
    const date = tech.getByLabel("Bill date");
    await date.click();
    await date.fill(`${d}/${m}/${y}`);
    await date.press("Enter");
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText(`${d}/${m}/${y}`);
    const bill = await db().bill.findFirst({ where: { patientId: patient.id } });
    expect(istDate(bill.createdAt)).toBe(`${y}-${m}-${d}`);
  });
});

test.describe("The bill page", () => {
  test("a partial UPI payment, then the rest by card; the print shows both", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Record payment" }).click();
    let dialog = tech.getByRole("dialog", { name: "Record payment" });
    await expect(dialog).toContainText("Balance due: ₹400.00");
    await dialog.getByLabel("Amount").fill("150");
    await chooseOption(tech, "Mode", "UPI", dialog);
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(figure(tech, "Balance")).toContainText("₹250.00");

    await tech.getByRole("button", { name: "Record payment" }).click();
    dialog = tech.getByRole("dialog", { name: "Record payment" });
    await expect(dialog.getByLabel("Amount")).toHaveValue("250"); // the new balance
    await chooseOption(tech, "Mode", "Card", dialog);
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
    await expect(tech.getByRole("main")).toContainText("StatusPaid");

    const [popup] = await Promise.all([tech.waitForEvent("popup"), tech.getByRole("button", { name: "Print bill" }).click()]);
    const sheet = popup.getByRole("main");
    await expect(sheet).toContainText("Paid (UPI)");
    await expect(sheet).toContainText("₹150.00");
    await expect(sheet).toContainText("Paid (Card)");
    await expect(sheet).toContainText("₹250.00");
  });

  test("a payment with an extra discount settles the bill and waits for approval", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Record payment" }).click();
    const dialog = tech.getByRole("dialog", { name: "Record payment" });
    await dialog.getByLabel("Extra discount").fill("50");
    await dialog.getByLabel("Amount").fill("250");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog).toBeHidden();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
    await expect(figure(tech, "Discount")).toContainText("₹50.00");
    await expect(tech.getByText(/Discount awaiting approval/)).toBeVisible();
  });

  test("the payment dialog explains an amount plus discount above the balance", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Record payment" }).click();
    const dialog = tech.getByRole("dialog", { name: "Record payment" });
    await dialog.getByLabel("Extra discount").fill("50"); // amount stays at the full ₹300
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(figure(tech, "Balance")).toContainText("₹300.00");
    expect(await db().transaction.count({ where: { billId: bill.id } })).toBe(0);
  });

  test("cancelling every test cancels the bill, refunds it all and hides the actions", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Cancel tests" }).click();
    const dialog = tech.getByRole("dialog", { name: "Cancel tests" });
    await dialog.getByLabel(/^CBC/).check();
    await dialog.getByLabel(/^GLUF/).check();
    await dialog.getByLabel("Reason").fill("Patient left");
    await expect(dialog).toContainText("About ₹400.00 is refunded to the patient.");
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog.getByText("Choose how it's refunded")).toBeVisible(); // the refund mode is required
    await chooseOption(tech, "Refund mode", "Cash", dialog);
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog).toBeHidden();
    await expect(tech.getByRole("main")).toContainText("Cancelled");
    await expect(tech.getByRole("row", { name: /Refund/ })).toContainText("-₹400.00");
    for (const name of ["Cancel tests", "Change discount", "Record payment"]) {
      await expect(tech.getByRole("button", { name })).toHaveCount(0);
    }
  });

  test("a discount change above the subtotal can't be saved", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Change discount" }).click();
    const dialog = tech.getByRole("dialog", { name: "Change discount" });
    await dialog.getByLabel("Discount").fill("250");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    // Whatever was typed, the discount never exceeds the ₹100 subtotal.
    await expect(figure(tech, "Discount")).toContainText("₹100.00");
    await expect(figure(tech, "Net amount")).toContainText("₹0.00");
  });

  test("the report time is set, changed and cleared", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    const [y, m, d] = istDate(new Date(Date.now() + 24 * 3600e3)).split("-");
    await tech.getByRole("button", { name: "Change", exact: true }).click();
    let dialog = tech.getByRole("dialog", { name: "Report expected by" });
    const field = dialog.getByLabel("Report expected by");
    await field.fill(`${d}/${m}/${y} 05:30 PM`);
    await field.press("Enter"); // confirms the time and submits the dialog
    await expect(dialog).toBeHidden();
    await expect(tech.getByRole("main")).toContainText(`${d}/${m}/${y} 05:30 PM`);

    await tech.getByRole("button", { name: "Change", exact: true }).click();
    dialog = tech.getByRole("dialog", { name: "Report expected by" });
    await dialog.getByLabel("Report expected by").hover();
    await dialog.locator(".ant-picker-clear").click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(tech.getByRole("main")).not.toContainText(`${d}/${m}/${y} 05:30 PM`);
    expect((await db().bill.findUnique({ where: { id: bill.id } })).expectedReportAt).toBeNull();
  });

  test("the lead reassigns a bill to another technician; the history says so", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const lead = await loginAs(users.lead);
    await lead.goto(`/bills/${bill.id}`);
    await lead.getByRole("button", { name: "Reassign" }).click();
    const dialog = lead.getByRole("dialog", { name: "Reassign bill" });
    await chooseOption(lead, "Assign to", users.tech2.name, dialog);
    await dialog.getByRole("button", { name: "Reassign" }).click();
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: /Reassigned from/ })).toContainText(`Reassigned from ${users.tech1.name} to ${users.tech2.name}`);
  });

  test("an accountant sees the bill but none of its actions", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const acct = await loginAs(users.acct);
    await acct.goto(`/bills/${bill.id}`);
    await expect(billHeading(acct)).toBeVisible();
    await expect(acct.getByRole("button", { name: "Print bill" })).toBeVisible();
    for (const name of ["Cancel tests", "Change discount", "Record payment", "Reassign", "Change"]) {
      await expect(acct.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  });

  test("the bills list finds a bill by number, patient name and phone", async ({ loginAs, users, techApi }) => {
    const ph = phone();
    const patient = await techApi.registerPatient({ name: uid("Findme"), phone: ph });
    const bill = await techApi.createBill({ patientId: patient.id, items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills");
    for (const q of [bill.billNumber, patient.name, ph]) {
      await tech.getByLabel("Search bills").fill(q);
      await tech.getByLabel("Search bills").press("Enter");
      await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
    }
    const status = tech.locator(".ant-segmented");
    await status.getByText("Balance due", { exact: true }).click();
    await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
    await status.getByText("Paid", { exact: true }).click();
    await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toHaveCount(0);
  });
});
