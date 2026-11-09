// More flows through the record-keeping screens: patients, the catalog and
// its approvals, referring doctors, panels' rates and camps.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, phone } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");

const figure = (page, label) => page.getByRole("group", { name: label, exact: true });
const code = () => uid("R").replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase();

async function pick(page, name, option, within = page) {
  const box = within.getByRole("combobox", { name: new RegExp(`^${name}`) });
  await box.click();
  await box.fill(option);
  await page.locator(".ant-select-dropdown:visible").getByTitle(option, { exact: true }).click();
}

// Approves or rejects the queue row matching `rowText`, as the signed-in reviewer.
async function decide(page, rowText, decision, note) {
  await page.goto("/approvals");
  const row = page.getByRole("row", { name: new RegExp(rowText) });
  if (decision === "approve") {
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
  } else {
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject request" });
    if (note) await dialog.getByLabel("Note").fill(note);
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(row).toBeHidden();
}

test.describe("Patients", () => {
  test("the register dialog checks every required field and the phone", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await tech.goto("/patients");
    await tech.getByRole("main").getByRole("button", { name: "Register patient" }).click();
    const dialog = tech.getByRole("dialog", { name: "Register patient" });
    await dialog.getByRole("button", { name: "Register" }).click();
    for (const text of ["Enter the patient's name", "Enter a 10-digit phone number", "Choose the sex", "Enter the age"]) {
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await dialog.getByLabel("Full name").fill("   ");
    await dialog.getByLabel("Phone").fill("98765 4321"); // nine digits
    await dialog.getByRole("button", { name: "Register" }).click();
    await expect(dialog.getByText("Enter the patient's name")).toBeVisible();
    await expect(dialog.getByText("Enter a 10-digit phone number")).toBeVisible();

    const name = uid("Pat");
    await dialog.getByLabel("Full name").fill(name);
    await dialog.getByLabel("Phone").fill(phone());
    await dialog.getByLabel("Male", { exact: true }).check();
    await dialog.getByLabel("Age (years)").fill("61");
    await dialog.getByRole("button", { name: "Register" }).click();
    await expect(tech.getByRole("heading", { name })).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("61 years");
    await expect(tech.getByRole("main")).toContainText("SexMale");
  });

  test("search finds a patient by number, phone and part of the name", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient({ name: uid("Searchable") });
    const tech = await loginAs(users.tech1);
    await tech.goto("/patients");
    const search = tech.getByLabel("Search patients");
    for (const q of [patient.patientNumber, patient.phone, patient.name.slice(0, 16)]) {
      await search.fill(q);
      await search.press("Enter");
      await expect(tech.getByRole("row", { name: new RegExp(patient.patientNumber) })).toBeVisible();
    }
    await search.fill("no-such-patient-zzz");
    await search.press("Enter");
    await expect(tech.getByRole("row", { name: new RegExp(patient.patientNumber) })).toHaveCount(0);
  });

  test("a patient's page lists their bills and quotations, each linked", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const bill = await techApi.createBill({ patientId: patient.id, items: ["GLUF"] });
    const quote = await techApi.createQuote({ items: ["CBC"], patientId: patient.id, patientName: undefined, patientPhone: undefined });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/patients/${patient.id}`);
    await expect(tech.getByRole("link", { name: bill.billNumber, exact: true })).toBeVisible();
    await expect(tech.getByRole("link", { name: quote.quoteNumber, exact: true })).toBeVisible();
    await tech.getByRole("link", { name: bill.billNumber, exact: true }).click();
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
  });

  test("a rejected correction leaves the patient as they were, and the requester sees why", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/patients/${patient.id}`);
    await tech.getByRole("button", { name: "Propose a correction" }).click();
    const dialog = tech.getByRole("dialog", { name: "Propose a correction" });
    await dialog.getByLabel("Full name").fill(`${patient.name} Wrong`);
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(tech.getByText("A correction is waiting for a pathologist's approval")).toBeVisible();

    const path = await loginAs(users.path1);
    await decide(path, patient.patientNumber, "reject", "Name matches the ID card");

    await tech.reload();
    await expect(tech.getByRole("heading", { name: patient.name, exact: true })).toBeVisible();
    await expect(tech.getByRole("button", { name: "Propose a correction" })).toBeEnabled();
    await tech.goto("/requests");
    await expect(tech.getByRole("main")).toContainText("Name matches the ID card");
  });
});

test.describe("Catalog", () => {
  test("the lead builds a profile in the grid; a test inside it then can't be retired", async ({ loginAs, users, leadApi }) => {
    const [t1, t2, p] = [code(), code(), code()];
    await leadApi.call("POST", "/catalog/changes", {
      changes: [t1, t2].map((c) => ({ action: "create", values: { code: c, name: `E2E part ${c}`, kind: "test", price: 80 } })),
    });
    const lead = await loginAs(users.lead);
    await lead.goto("/catalog/entry");
    await lead.getByLabel("Row 1 code").fill(p);
    await lead.getByLabel("Row 1 name").fill("E2E grid profile");
    await chooseOption(lead, "Row 1 kind", "Profile");
    await expect(lead.getByLabel("Row 1 machines")).toBeDisabled();
    await lead.getByLabel("Row 1 price").fill("140");
    const tests = lead.getByLabel("Row 1 tests");
    for (const c of [t1, t2]) {
      await tests.click();
      await tests.fill(c);
      await lead.locator(".ant-select-dropdown:visible").getByTitle(`${c} · E2E part ${c}`).click();
    }
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText("1 catalog item is saved.")).toBeVisible();

    await lead.getByLabel("Search the catalog").fill(p);
    await expect(lead.getByRole("row", { name: new RegExp(p) })).toContainText([t1, t2].sort().join(", "));
    await lead.getByLabel("Search the catalog").fill(t1);
    await lead.getByRole("row", { name: new RegExp(t1) }).getByRole("button", { name: "Retire" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Retire" }).click();
    await expect(lead.getByText(new RegExp(`${p}`)).filter({ hasText: /profile|retire/i }).first()).toBeVisible();
    expect((await db().catalogItem.findUnique({ where: { code: t1 } })).status).toBe("active");
  });

  test("a technician's retirement waits; the lead rejects it and the item stays", async ({ loginAs, users, leadApi }) => {
    const c = code();
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code: c, name: "E2E keep me", kind: "test", price: 60 } }] });
    const tech = await loginAs(users.tech1);
    await tech.goto("/catalog");
    await tech.getByLabel("Search the catalog").fill(c);
    await tech.getByRole("row", { name: new RegExp(c) }).first().getByRole("button", { name: "Retire" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Retire" }).click();
    await expect(tech.getByText(`Retiring ${c} is sent to the lead for approval.`)).toBeVisible();
    await expect(tech.getByRole("region", { name: "Your changes waiting for approval" }).or(tech.getByRole("main"))).toContainText(c);

    const lead = await loginAs(users.lead);
    await decide(lead, c, "reject", "Still in use");
    await lead.goto("/catalog");
    await lead.getByLabel("Search the catalog").fill(c);
    await expect(lead.getByRole("row", { name: new RegExp(c) })).toContainText("₹60.00");
    expect((await db().catalogItem.findUnique({ where: { code: c } })).status).toBe("active");
  });

  test("machines that run together are joined with '+'; an unknown one is named", async ({ loginAs, users, leadApi }) => {
    const [c, other] = [code(), uid("E2E Analyser")];
    await leadApi.call("POST", "/machines/types", { name: other });
    const lead = await loginAs(users.lead);
    await lead.goto("/catalog/entry");
    await lead.getByLabel("Row 1 code").fill(c);
    await lead.getByLabel("Row 1 name").fill("E2E parallel machines");
    await lead.getByLabel("Row 1 price").fill("70");
    const machines = lead.getByLabel("Row 1 machines");
    await machines.click();
    await machines.fill("haematology");
    await lead.locator(".ant-select-dropdown:visible").getByTitle(BASELINE.machineType, { exact: true }).click();
    await machines.pressSequentially(" + ");
    // Right after a separator, every machine type is offered.
    await expect(lead.locator(".ant-select-dropdown:visible").getByTitle(other, { exact: true })).toBeVisible();
    await lead.locator(".ant-select-dropdown:visible").getByTitle(other, { exact: true }).click();
    await expect(machines).toHaveValue(`${BASELINE.machineType} + ${other}`);

    await machines.pressSequentially(" > Nonexistent box");
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText('Unknown machine type "Nonexistent box"')).toBeVisible();
    await machines.fill(`${BASELINE.machineType} + ${other}`);
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText("1 catalog item is saved.")).toBeVisible();
    await lead.getByLabel("Search the catalog").fill(c);
    // Machines in one step run together, so either order is right.
    const row = lead.getByRole("row", { name: new RegExp(c) });
    await expect(row).toContainText(new RegExp(`(${BASELINE.machineType} \\+ ${other}|${other} \\+ ${BASELINE.machineType})`));
  });
});

test.describe("Referring doctors", () => {
  test("a technician's doctor is usable at once; rejected by the lead, it leaves the picker", async ({ loginAs, users }) => {
    const name = uid("Dr. E2E");
    const tech = await loginAs(users.tech1);
    await tech.goto("/doctors");
    await tech.getByRole("button", { name: "Add doctor" }).first().click();
    const dialog = tech.getByRole("dialog", { name: "Add doctor" });
    await dialog.getByRole("button", { name: "Add doctor" }).click();
    await expect(dialog.getByText("Enter the doctor's name")).toBeVisible();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Add doctor" }).click();
    await expect(dialog).toBeHidden();
    await expect(tech.getByRole("row", { name: new RegExp(name.replace(/\./g, "\\.")) })).toBeVisible();

    await tech.goto("/bills/new");
    await tech.getByRole("radio", { name: "Doctor" }).check();
    const doctor = tech.getByRole("combobox", { name: /^Referring doctor/ });
    await doctor.click();
    await doctor.fill(name);
    await expect(tech.locator(".ant-select-dropdown:visible").getByTitle(`${name} (awaiting approval)`)).toBeVisible();

    const lead = await loginAs(users.lead);
    await decide(lead, name.replace(/\./g, "\\."), "reject");
    await tech.reload();
    await tech.getByRole("radio", { name: "Doctor" }).check();
    await doctor.click();
    await doctor.fill(name);
    await expect(tech.locator(".ant-select-dropdown:visible").getByTitle(new RegExp(name.replace(/\./g, "\\.")))).toHaveCount(0);
  });
});

test.describe("Panels and camps", () => {
  test("a panel's rates set in the app price the next bill: % off, and a custom price that wins", async ({ loginAs, users, techApi }) => {
    const panel = uid("E2E Rates Panel");
    const lead = await loginAs(users.lead);
    await lead.goto("/panels");
    await lead.getByRole("button", { name: "Add panel" }).click();
    let dialog = lead.getByRole("dialog", { name: "Add panel" });
    await dialog.getByLabel("Name").fill(panel);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const row = lead.getByRole("row", { name: new RegExp(panel) });
    await expect(row).toContainText("Catalog prices");

    await row.getByRole("button", { name: "Rates" }).click();
    dialog = lead.getByRole("dialog", { name: `${panel}: standing rates` });
    await dialog.getByLabel("Discount on catalog prices (%)").fill("20");
    await dialog.getByRole("button", { name: "Add a custom price" }).click();
    await pick(lead, "Item 1", "GLUF · Glucose fasting (₹100.00)", dialog);
    await dialog.getByLabel("Price 1").fill("75");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("20% off · 1 custom price");

    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await addItem(tech, "GLUF");
    await tech.getByRole("radio", { name: "Panel" }).check();
    await pick(tech, "Panel", panel);
    await expect(figure(tech, "Net amount")).toContainText("₹315.00"); // 300 - 20% + 75
  });

  test("a camp scheduled for later shows as such and can't be chosen on a bill yet", async ({ loginAs, users, leadApi }) => {
    const panel = await leadApi.addPanel();
    const camp = uid("E2E Future camp");
    const day = (n) => new Date(Date.now() + n * 86400e3).toISOString();
    await leadApi.call("POST", "/camps", { panelId: panel.id, name: camp, locationId: (await baseline.branch()).id, startsAt: day(3), endsAt: day(4), discountPercent: 10, items: [] });
    const lead = await loginAs(users.lead);
    await lead.goto("/panels");
    await expect(lead.getByRole("row", { name: new RegExp(camp) })).toContainText("Scheduled");

    await lead.goto("/bills/new");
    await lead.getByRole("radio", { name: "Panel" }).check();
    await pick(lead, "Panel", panel.name);
    await expect(lead.getByText("This panel has no camp running now.")).toBeVisible();
    await expect(lead.getByRole("combobox", { name: /^Camp/ })).toBeDisabled();
  });

  test("removing a panel asks first; afterwards it's gone from the bill's panel picker", async ({ loginAs, users, leadApi }) => {
    const panel = await leadApi.addPanel();
    const lead = await loginAs(users.lead);
    await lead.goto("/panels");
    const row = lead.getByRole("row", { name: new RegExp(panel.name) });
    await row.getByRole("button", { name: "Remove" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Remove" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Remove" }).click();
    await expect(row).toBeHidden();

    await lead.goto("/bills/new");
    await lead.getByRole("radio", { name: "Panel" }).check();
    const box = lead.getByRole("combobox", { name: /^Panel/ });
    await box.click();
    await box.fill(panel.name);
    await expect(lead.locator(".ant-select-dropdown:visible").getByTitle(panel.name, { exact: true })).toHaveCount(0);
  });
});
