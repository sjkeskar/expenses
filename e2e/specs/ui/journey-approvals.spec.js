// The pathologist's and the lead's side, through the screens: deciding the
// technicians' discounts, cancellations and corrections from the queue, what
// each decision does to the bill, and the lead's own work on the catalog
// and the machines.
const { test, expect } = require("../../fixtures");
const { baseline, createUser, db } = require("../../helpers/db");
const { uid, phone } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");
const { figure, section, holdNotice, decide, addCatalogItem, newCode } = require("../../helpers/flows");

const history = (page) => section(page, "History");
const queueRow = (page, text) => page.getByRole("row", { name: new RegExp(text) });

test.describe("Discounts", () => {
  test("a pathologist approves a technician's discount from the queue: the bill's hold lifts", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"], discountAmount: 40 });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await expect(holdNotice(tech)).toContainText("Discount awaiting approval");

    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    const row = queueRow(path, bill.billNumber);
    // What's asked, for whom and by whom, with the bill one click away.
    for (const text of ["Discount", "₹0.00", "₹40.00", bill.patient.name, `${users.tech1.name} (Technician)`]) await expect(row).toContainText(text);
    await row.getByRole("link", { name: bill.billNumber }).click();
    await expect(path.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await expect(figure(path, "Net amount")).toContainText("₹260.00");

    await decide(path, bill.billNumber, "approve");
    await expect(path.getByText("1 request approved.")).toBeVisible();
    await tech.reload();
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await expect(tech.getByText("Report on hold")).toHaveCount(0);
    await expect(figure(tech, "Discount")).toContainText("₹40.00"); // approving moves no money
    await expect(history(tech).getByRole("row", { name: /Discount: ₹0\.00 → ₹40\.00/ })).toContainText("Approved");
  });

  test("a rejected discount: the full amount is due again, and the report is held until it's paid", async ({ loginAs, users, techApi, api }) => {
    const bill = await techApi.createBill({ items: ["CBC"], discountAmount: 50, initialPayment: { amount: 250, mode: "cash" } });
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" });
    await (await api(users.path1)).decide(approval.id, "reject", "No reason given");

    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    // It had been paid in full at the discounted amount; now ₹50 is owed.
    await expect(tech.getByRole("main")).toContainText("StatusBalance due");
    await expect(figure(tech, "Discount")).toContainText("₹0.00");
    await expect(figure(tech, "Balance")).toContainText("₹50.00");
    await expect(holdNotice(tech)).toContainText("Discount rejected: full amount due");
    await expect(history(tech).getByRole("row", { name: /Discount: ₹0\.00 → ₹50\.00/ })).toContainText("Rejected");
    await expect(history(tech).getByRole("row", { name: /Discount: ₹0\.00 → ₹50\.00/ })).toContainText("No reason given");
    await expect(history(tech).getByRole("row", { name: /Discount reverted \(rejected\)/ })).toBeVisible();

    await tech.getByRole("button", { name: "Record payment" }).click();
    const dialog = tech.getByRole("dialog", { name: "Record payment" });
    await expect(dialog.getByLabel("Amount")).toHaveValue("50");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(figure(tech, "Balance")).toContainText("₹0.00");
    await expect(tech.getByText("Report on hold")).toHaveCount(0);
  });

  test("a pathologist's own discount needs no one else: approved as their own, no hold, nothing in the queue", async ({ loginAs, users, api }) => {
    const pathApi = await api(users.path1);
    const bill = await pathApi.createBill({ items: ["CBC"] });
    const path = await loginAs(users.path1);
    await path.goto(`/bills/${bill.id}`);
    await path.getByRole("button", { name: "Change discount" }).click();
    const dialog = path.getByRole("dialog", { name: "Change discount" });
    await dialog.getByLabel("Discount").fill("30");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(figure(path, "Discount")).toContainText("₹30.00");
    await expect(path.getByText("Report on hold")).toHaveCount(0);
    await expect(history(path).getByRole("row", { name: /Discount: ₹0\.00 → ₹30\.00/ })).toContainText("Approved (own)");
    await path.goto("/approvals");
    await expect(path.getByRole("heading", { name: "Approval queue" })).toBeVisible();
    await expect(queueRow(path, bill.billNumber)).toHaveCount(0);
  });

  test("a pathologist changing a technician's pending discount settles it there and then", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"], discountAmount: 100 });
    const path = await loginAs(users.path1);
    await path.goto(`/bills/${bill.id}`);
    await expect(holdNotice(path)).toContainText("Discount awaiting approval");
    await path.getByRole("button", { name: "Change discount" }).click();
    const dialog = path.getByRole("dialog", { name: "Change discount" });
    await dialog.getByLabel("Discount").fill("60");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(figure(path, "Discount")).toContainText("₹60.00");
    await expect(path.getByText("Report on hold")).toHaveCount(0);
    await expect(history(path).getByRole("row", { name: /Discount: ₹0\.00 → ₹60\.00/ })).toContainText("Approved");
  });
});

test.describe("Cancellations", () => {
  test("the queue shows what was cancelled, the refund and the reason; approving lifts the hold", async ({ loginAs, users, techApi }) => {
    const created = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    await techApi.cancel(created, ["GLUF"], { reason: "Patient had eaten", refundMode: "cash" });
    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    const row = queueRow(path, created.billNumber);
    for (const text of ["Cancellation", "Cancelled GLUF, refunded ₹100.00", "Reason: Patient had eaten"]) await expect(row).toContainText(text);
    await decide(path, created.billNumber, "approve");

    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${created.id}`);
    await expect(tech.getByText("Report on hold")).toHaveCount(0);
    await expect(history(tech).getByRole("row", { name: /Cancellation: GLUF, refund ₹100\.00/ })).toContainText("Approved");
    await expect(figure(tech, "Net amount")).toContainText("₹300.00");
  });

  test("a pathologist's own cancellation is approved as their own, and holds nothing", async ({ loginAs, users, api }) => {
    const pathApi = await api(users.path1);
    const bill = await pathApi.createBill({ items: ["CBC", "GLUF"] });
    const path = await loginAs(users.path1);
    await path.goto(`/bills/${bill.id}`);
    await path.getByRole("button", { name: "Cancel tests" }).click();
    const dialog = path.getByRole("dialog", { name: "Cancel tests" });
    await dialog.getByLabel(/^GLUF/).check();
    await dialog.getByLabel("Reason").fill("Entered by mistake");
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog).toBeHidden();
    await expect(path.getByText("Report on hold")).toHaveCount(0);
    await expect(history(path).getByRole("row", { name: /Cancellation: GLUF/ })).toContainText("Approved (own)");
    await expect(figure(path, "Balance")).toContainText("₹300.00");
  });

  test("a rejected cancellation stays cancelled, holds the report, and waits for the lead only", async ({ loginAs, users, techApi }) => {
    const created = await techApi.createBill({ items: ["CBC", "GLUF"] });
    await techApi.cancel(created, ["GLUF"]);
    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    await queueRow(path, created.billNumber).getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = path.getByRole("dialog", { name: "Reject request" });
    await expect(dialog).toContainText("the report stays on hold until the lead marks the matter resolved");
    await dialog.getByLabel("Note").fill("Should have been billed");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog).toBeHidden();
    // Rejected cancellations are the lead's to resolve, not another pathologist's.
    await expect(path.getByRole("heading", { name: "Rejected cancellations to resolve" })).toHaveCount(0);

    await path.goto(`/bills/${created.id}`);
    await expect(holdNotice(path)).toContainText("Cancellation rejected: awaiting the lead");
    await expect(path.getByRole("row", { name: /^GLUF/ }).first()).toContainText("Cancelled"); // the refund was given; it isn't undone
    const lead = await loginAs(users.lead);
    await lead.goto("/approvals");
    const waiting = section(lead, "Rejected cancellations to resolve").getByRole("row", { name: new RegExp(created.billNumber) });
    await expect(waiting).toContainText(`by ${users.path1.name}: Should have been billed`);
  });
});

test.describe("The queue itself", () => {
  test("a request decided at another desk meanwhile: the second pathologist is told, and it leaves their queue", async ({ loginAs, users, techApi, api }) => {
    const bill = await techApi.createBill({ items: ["CBC"], discountAmount: 20 });
    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    const row = queueRow(path, bill.billNumber);
    await expect(row).toBeVisible();
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" });
    await (await api(users.path2)).decide(approval.id, "reject", "Too much");

    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await path.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
    await expect(path.getByText("This request has already been reviewed.")).toBeVisible();
    await expect(row).toBeHidden();
    expect((await db().approval.findUnique({ where: { id: approval.id } })).status).toBe("rejected"); // the first decision stands
  });

  test("several requests are rejected together with one note, each requester seeing it", async ({ loginAs, users, techApi }) => {
    const bills = [await techApi.createBill({ discountAmount: 10 }), await techApi.createBill({ discountAmount: 15 })];
    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    for (const b of bills) await queueRow(path, b.billNumber).getByRole("checkbox").check();
    await path.getByRole("button", { name: "Reject selected" }).click();
    const dialog = path.getByRole("dialog", { name: "Reject 2 requests" });
    await dialog.getByLabel("Note").fill("Ask before discounting");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(path.getByText("2 requests rejected.")).toBeVisible();
    for (const b of bills) {
      await expect(queueRow(path, b.billNumber)).toHaveCount(0);
      expect((await techApi.getBill(b.id)).discountAmount).toBe("0");
    }
    const tech = await loginAs(users.tech1);
    await tech.goto("/requests");
    for (const b of bills) await expect(tech.getByRole("row", { name: new RegExp(b.billNumber) }).first()).toContainText("Ask before discounting");
  });

  test("the quick access bar's count is the number waiting in the pathologist's queue", async ({ loginAs, users, techApi }) => {
    await techApi.createBill({ discountAmount: 10 });
    const path = await loginAs(users.path1);
    const bar = path.getByRole("navigation", { name: "Quick access" }).getByRole("button");
    // Other desks add to and clear the queue all the time, so the bar and the
    // queue are compared at one moment, after a fresh load of both.
    await expect(async () => {
      await path.goto("/approvals");
      await expect(path.getByRole("heading", { name: "Approval queue" })).toBeVisible();
      await expect(section(path, "Waiting for a decision").locator("tbody tr.ant-table-row").first()).toBeVisible();
      const rows = await section(path, "Waiting for a decision").locator("tbody tr.ant-table-row").count();
      await expect(bar).toHaveAccessibleName(`Approval queue, ${rows} waiting`, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await bar.click();
    await expect(path).toHaveURL(/\/approvals$/);
  });

  test("a technician has no approval queue: the address sends them Home", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    await expect(tech.getByRole("menuitem", { name: "Approval queue" })).toHaveCount(0);
    await tech.goto("/approvals");
    await expect(tech.getByRole("heading", { name: `Welcome, ${users.tech1.name}` })).toBeVisible();
  });

  test("approving a correction that would now duplicate another patient is refused, with the reason", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient({ sex: "female", ageYears: 31 });
    const target = { name: uid("Twin"), phone: phone() };
    await techApi.call("POST", `/patients/${patient.id}/corrections`, target);
    // Someone with exactly the corrected details registers before the approval.
    const other = await techApi.registerPatient({ ...target, sex: "female", ageYears: 31 });

    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    const row = queueRow(path, patient.patientNumber);
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await path.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
    await expect(path.getByText(`These details belong to another patient (${other.name}, ${other.patientNumber}).`)).toBeVisible();
    await expect(row).toBeVisible(); // still waiting: it can be rejected instead
    expect((await db().patient.findUnique({ where: { id: patient.id } })).name).toBe(patient.name);
  });
});

test.describe("The catalog, proposed and approved", () => {
  test("a pathologist's new test waits for the lead; the pathologist follows it in My requests", async ({ loginAs, users, api }) => {
    const code = newCode("P");
    const pathApi = await api(users.path1);
    await pathApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: `E2E ${code}`, kind: "test", price: 220, sampleType: "Urine" } }] });

    const path = await loginAs(users.path1);
    await path.goto("/requests");
    const mine = path.getByRole("row", { name: new RegExp(code) });
    await expect(mine).toContainText("Pending");
    await path.goto("/approvals");
    await expect(path.getByRole("heading", { name: "Approval queue" })).toBeVisible();
    await expect(queueRow(path, code)).toHaveCount(0); // not theirs to approve
    // Not billable until the lead says so.
    await path.goto("/bills/new");
    const search = path.getByLabel("Add a test, profile or service");
    await search.click();
    await search.fill(code);
    await expect(path.locator(`.ant-select-dropdown:visible [title^="${code} · "]`)).toHaveCount(0);

    const lead = await loginAs(users.lead);
    await lead.goto("/approvals");
    const row = queueRow(lead, code);
    for (const text of [`Add ${code}`, "Price: ₹220.00", "Sample type: Urine", `${users.path1.name} (Pathologist)`]) await expect(row).toContainText(text);
    await decide(lead, code, "approve");

    await path.goto("/requests");
    await expect(mine).toContainText("Approved");
    await expect(mine).toContainText(users.lead.name);
    await path.goto("/bills/new");
    await chooseOption(path, "Branch or centre", BASELINE.branch.name);
    await addItem(path, code);
    await expect(figure(path, "Net amount")).toContainText("₹220.00");
  });

  test("a technician's price change, once the lead approves it, prices new bills only", async ({ loginAs, users, leadApi, techApi }) => {
    const item = await addCatalogItem(leadApi, { price: 100 });
    const old = await techApi.createBill({ items: [item.code] });
    await techApi.call("POST", "/catalog/changes", {
      changes: [{ action: "update", catalogItemId: item.id, values: { code: item.code, name: item.name, kind: "test", price: 150 } }],
    });

    const tech = await loginAs(users.tech1);
    const patient = await techApi.registerPatient();
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, item.code);
    await expect(figure(tech, "Net amount")).toContainText("₹100.00"); // still the approved price

    const lead = await loginAs(users.lead);
    await lead.goto("/approvals");
    const row = queueRow(lead, item.code);
    await expect(row).toContainText(`Edit ${item.code}`);
    await expect(row).toContainText("₹100.00");
    await expect(row).toContainText("₹150.00");
    await decide(lead, item.code, "approve");

    await tech.reload();
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, item.code);
    await expect(figure(tech, "Net amount")).toContainText("₹150.00");
    await tech.goto(`/bills/${old.id}`);
    await expect(figure(tech, "Net amount")).toContainText("₹100.00");
    await expect(tech.getByRole("row", { name: new RegExp(`^${item.code}`) }).first()).toContainText("₹100.00");
  });

  test("the lead rejects a proposed test: nothing reaches the catalog, and the proposer sees why", async ({ loginAs, users, techApi }) => {
    const code = newCode("X");
    await techApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: `E2E ${code}`, kind: "test", price: 90 } }] });
    const lead = await loginAs(users.lead);
    await decide(lead, code, "reject", "We don't run this test");
    expect(await db().catalogItem.count({ where: { code } })).toBe(0);
    const tech = await loginAs(users.tech1);
    await tech.goto("/requests");
    const mine = tech.getByRole("row", { name: new RegExp(code) });
    await expect(mine).toContainText("Rejected");
    await expect(mine).toContainText("We don't run this test");
  });
});

test.describe("Machines (lead only)", () => {
  const addType = async (page, name) => {
    await page.getByRole("button", { name: "Add machine type" }).click();
    const dialog = page.getByRole("dialog", { name: "Add machine type" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    return dialog;
  };
  const addMachine = async (page, name, type) => {
    await page.getByRole("button", { name: "Add machine", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add machine" });
    await dialog.getByLabel("Name").fill(name);
    await chooseOption(page, "Type", type, dialog);
    await chooseOption(page, "Branch", BASELINE.branch.name, dialog);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    return dialog;
  };

  test("pathologists and technicians don't manage machines: no menu entry, and the address sends them Home", async ({ loginAs, users }) => {
    for (const user of [users.path1, users.tech1]) {
      const page = await loginAs(user);
      await expect(page.getByRole("menuitem", { name: "Machines" })).toHaveCount(0);
      await page.goto("/machines");
      await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();
    }
  });

  test("a machine type or a machine name already in use is reported inside the dialog", async ({ loginAs, users }) => {
    const [type, machine] = [uid("E2E Type"), uid("E2E Unit")];
    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    await expect(await addType(lead, type)).toBeHidden();
    let dialog = await addType(lead, type);
    await expect(dialog.getByRole("alert")).toContainText("A machine type with that name already exists.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await db().machineType.count({ where: { name: type } })).toBe(1);

    await expect(await addMachine(lead, machine, type)).toBeHidden();
    dialog = await addMachine(lead, machine, type);
    await expect(dialog.getByRole("alert")).toContainText(`${BASELINE.branch.name} already has a machine with that name.`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await db().machine.count({ where: { name: machine } })).toBe(1);
    // The type's row counts its machines.
    await expect(section(lead, "Machine types").getByRole("row", { name: new RegExp(type) })).toContainText("1");
  });

  test("the forms name what's missing", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    await lead.getByRole("button", { name: "Add machine", exact: true }).click();
    const dialog = lead.getByRole("dialog", { name: "Add machine" });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    for (const text of ["Enter a name", "Choose its type", "Choose the branch"]) await expect(dialog.getByText(text)).toBeVisible();
    // A collection centre processes nothing, so it isn't offered for a machine.
    const branch = dialog.getByLabel("Branch", { exact: true });
    await branch.click();
    await branch.fill(BASELINE.centre.name);
    await expect(lead.locator(".ant-select-dropdown:visible").getByTitle(BASELINE.centre.name, { exact: true })).toHaveCount(0);
  });

  test("removing a machine asks first, then takes it off its branch's list", async ({ loginAs, users }) => {
    const [type, machine] = [uid("E2E Type"), uid("E2E Unit")];
    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    await expect(await addType(lead, type)).toBeHidden();
    await expect(await addMachine(lead, machine, type)).toBeHidden();
    const row = section(lead, "Machines").getByRole("row", { name: new RegExp(machine) });
    await row.getByRole("button", { name: "Remove" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Remove" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Remove" }).click();
    await expect(lead.getByText(`${machine} is removed.`)).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(section(lead, "Machine types").getByRole("row", { name: new RegExp(type) })).toContainText("0");
  });

  test("a removed machine type is no longer offered, but a test already using it keeps it", async ({ loginAs, users, leadApi }) => {
    const type = uid("E2E Type");
    const { type: created } = await leadApi.call("POST", "/machines/types", { name: type });
    const item = await addCatalogItem(leadApi, { price: 100, machineSteps: [{ sequence: 1, machineTypeId: created.id }] });

    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    const row = section(lead, "Machine types").getByRole("row", { name: new RegExp(type) });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(lead.getByRole("tooltip")).toContainText("Tests already using it keep it.");
    await lead.getByRole("tooltip").getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);

    await lead.getByRole("button", { name: "Add machine", exact: true }).click();
    const dialog = lead.getByRole("dialog", { name: "Add machine" });
    const types = dialog.getByLabel("Type", { exact: true });
    await types.click();
    await types.fill(type);
    await expect(lead.locator(".ant-select-dropdown:visible").getByTitle(type, { exact: true })).toHaveCount(0);
    const steps = await db().catalogMachineStep.findMany({ where: { itemId: item.id }, include: { machineType: true } });
    expect(steps.map((s) => s.machineType.name)).toEqual([type]);
  });

  test("a machine type that was removed can be added again under the same name", async ({ loginAs, users, leadApi }) => {
    const type = uid("E2E Type");
    const { type: created } = await leadApi.call("POST", "/machines/types", { name: type });
    await leadApi.call("DELETE", `/machines/types/${created.id}`);
    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    await expect(section(lead, "Machine types").getByRole("row", { name: new RegExp(type) })).toHaveCount(0);
    const dialog = await addType(lead, type);
    await expect(dialog).toBeHidden();
    await expect(section(lead, "Machine types").getByRole("row", { name: new RegExp(type) })).toBeVisible();
  });

  test("a machine that was removed can be added again at the same branch under the same name", async ({ loginAs, users, leadApi }) => {
    const machine = uid("E2E Unit");
    const { machine: created } = await leadApi.call("POST", "/machines", { name: machine, machineTypeId: (await baseline.machineType()).id, branchId: (await baseline.branch()).id });
    await leadApi.call("DELETE", `/machines/${created.id}`);
    const lead = await loginAs(users.lead);
    await lead.goto("/machines");
    const dialog = await addMachine(lead, machine, BASELINE.machineType);
    await expect(dialog).toBeHidden();
    await expect(section(lead, "Machines").getByRole("row", { name: new RegExp(machine) })).toBeVisible();
  });
});

test.describe("Panels (lead only)", () => {
  test("a panel that was removed can be added again under the same name", async ({ loginAs, users, leadApi }) => {
    const panel = await leadApi.addPanel();
    await leadApi.call("DELETE", `/panels/${panel.id}`);
    const lead = await loginAs(users.lead);
    await lead.goto("/panels");
    await expect(lead.getByRole("row", { name: new RegExp(panel.name) })).toHaveCount(0);
    await lead.getByRole("button", { name: "Add panel" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add panel" });
    await dialog.getByLabel("Name").fill(panel.name);
    await dialog.getByLabel("Corporate").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: new RegExp(panel.name) })).toContainText("Catalog prices");
    expect(await db().panel.count({ where: { name: panel.name } })).toBe(1); // the same record, back in use
  });

  test("a panel name already in use is reported inside the dialog", async ({ loginAs, users, leadApi }) => {
    const panel = await leadApi.addPanel();
    const lead = await loginAs(users.lead);
    await lead.goto("/panels");
    await lead.getByRole("button", { name: "Add panel" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add panel" });
    await dialog.getByLabel("Name").fill(panel.name);
    await dialog.getByLabel("Corporate").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("A panel with that name already exists.");
  });
});

test.describe("Who decides what", () => {
  test("a pathologist's queue never offers catalog changes or new doctors; the lead's has both", async ({ loginAs, users, techApi }) => {
    const code = newCode("W");
    await techApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: `E2E ${code}`, kind: "test", price: 75 } }] });
    const { doctor } = await techApi.call("POST", "/doctors", { name: uid("Dr Queue") });

    const path = await loginAs(users.path1);
    await path.goto("/approvals");
    await expect(path.getByText("Discounts, cancellations and patient corrections.")).toBeVisible();
    await expect(queueRow(path, code)).toHaveCount(0);
    await expect(queueRow(path, doctor.name)).toHaveCount(0);

    const lead = await loginAs(users.lead);
    await lead.goto("/approvals");
    await expect(queueRow(lead, code)).toContainText("Catalog change");
    await expect(queueRow(lead, doctor.name)).toContainText("New doctor");
  });

  test("a deactivated pathologist's open queue stops working: they're sent to sign in", async ({ loginAs, users, techApi }) => {
    const gone = await createUser("pathologist");
    const bill = await techApi.createBill({ discountAmount: 25 });
    const page = await loginAs(gone);
    await page.goto("/approvals");
    const row = queueRow(page, bill.billNumber);
    await expect(row).toBeVisible();
    await db().user.update({ where: { id: gone.id }, data: { isDeleted: true } });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await techApi.approvalFor({ billId: bill.id, subjectType: "bill_discount" })).status).toBe("pending");
  });
});
