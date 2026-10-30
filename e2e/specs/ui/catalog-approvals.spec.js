// Step 3 screens: the catalog, its entry grid, machines, doctors, the
// approval queue and "My requests".
const { test, expect } = require("../../fixtures");
const { db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption } = require("../../helpers/ui");

const code = () => uid("U").replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase();

async function approveInQueue(page, rowText) {
  await page.goto("/approvals");
  const row = page.getByRole("row", { name: new RegExp(rowText) });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
  await expect(row).toBeHidden();
}

test.describe("Catalog entry", () => {
  test("a technician's row goes to the lead, who approves it into the catalog", async ({ loginAs, users }) => {
    const c = code();
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Tests & profiles" }).click();
    await tech.getByRole("button", { name: "Add items" }).click();
    await tech.getByLabel("Row 1 code").fill(c);
    await tech.getByLabel("Row 1 name").fill("E2E Ferritin");
    await tech.getByLabel("Row 1 price").fill("650");
    await tech.getByLabel("Row 1 machines").fill(BASELINE.machineType);
    await tech.getByRole("button", { name: "Submit for approval" }).click();
    await expect(tech.getByText("1 change is sent to the lead for approval.")).toBeVisible();
    // Back on the catalog, in "Your changes waiting for approval".
    await expect(tech.getByRole("row", { name: new RegExp(c) })).toContainText("Add");

    const lead = await loginAs(users.lead);
    await approveInQueue(lead, c);
    await lead.goto("/catalog");
    await lead.getByLabel("Search the catalog").fill(c);
    await expect(lead.getByRole("row", { name: new RegExp(c) })).toContainText("₹650.00");
    await expect(lead.getByRole("row", { name: new RegExp(c) })).toContainText(`Single · ${BASELINE.machineType}`);
  });

  test("rows pasted from Excel, a test and a profile, saved by the lead", async ({ loginAs, users }) => {
    const [t, p] = [code(), code()];
    const lead = await loginAs(users.lead);
    await lead.goto("/catalog/entry");
    await lead.getByRole("button", { name: "Paste from Excel" }).click();
    const dialog = lead.getByRole("dialog", { name: "Paste from Excel" });
    await dialog.getByLabel("Rows").fill(
      [
        "Code\tName\tKind\tDepartment\tSample type\tContainer\tPrice\tDraws\tMachines\tTests\tInstructions",
        `${t}\tE2E Pasted test\ttest\tBiochemistry\tSerum\tRed top\t120\tFasting, 2 h\t${BASELINE.machineType}\t\tFast for 10 hours`,
        `${p}\tE2E Pasted profile\tProfile\t\t\t\t₹1,300\t\t\tCHOL, TG\t`,
      ].join("\n")
    );
    await dialog.getByRole("button", { name: "Add rows" }).click();
    await expect(lead.getByLabel("Row 2 code")).toHaveValue(p);
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText("2 catalog items are saved.")).toBeVisible();

    await lead.getByLabel("Search the catalog").fill(t);
    const testRow = lead.getByRole("row", { name: new RegExp(t) });
    await expect(testRow).toContainText(`Fasting, 2 h · ${BASELINE.machineType}`);
    await expect(testRow).toContainText("Fast for 10 hours");
    await lead.getByLabel("Search the catalog").fill(p);
    await expect(lead.getByRole("row", { name: new RegExp(p) })).toContainText("CHOL, TG");
    await expect(lead.getByRole("row", { name: new RegExp(p) })).toContainText("₹1,300.00");
  });

  test("row errors come back per row and nothing is saved", async ({ loginAs, users }) => {
    const good = code();
    const lead = await loginAs(users.lead);
    await lead.goto("/catalog/entry");
    for (const [row, c] of [[1, good], [2, "CBC"]]) {
      await lead.getByLabel(`Row ${row} code`).fill(c);
      await lead.getByLabel(`Row ${row} name`).fill("E2E row");
      await lead.getByLabel(`Row ${row} price`).fill("10");
    }
    await lead.getByLabel("Row 1 machines").fill("No such machine");
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText('Unknown machine type "No such machine"')).toBeVisible();
    await lead.getByLabel("Row 1 machines").fill("");
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByRole("alert")).toContainText("Row 2: Code CBC is already in use.");
    expect(await db().catalogItem.count({ where: { code: good } })).toBe(0);
  });

  test("editing an item from the catalog", async ({ loginAs, users, leadApi }) => {
    const c = code();
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code: c, name: "E2E to edit", kind: "test", price: 100 } }] });
    const lead = await loginAs(users.lead);
    await lead.goto("/catalog");
    await lead.getByLabel("Search the catalog").fill(c);
    await lead.getByRole("row", { name: new RegExp(c) }).getByRole("button", { name: "Edit" }).click();
    await expect(lead.getByRole("heading", { name: "Edit catalog items" })).toBeVisible();
    await expect(lead.getByLabel("Row 1 kind")).toBeDisabled();
    await lead.getByLabel("Row 1 price").fill("125");
    await lead.getByRole("button", { name: "Save" }).click();
    await lead.getByLabel("Search the catalog").fill(c);
    await expect(lead.getByRole("row", { name: new RegExp(c) })).toContainText("₹125.00");
  });
});

test.describe("Machines and doctors", () => {
  test("the lead adds a machine type and a machine at a branch", async ({ loginAs, users }) => {
    const [type, machine] = [uid("Type"), uid("Unit")];
    const lead = await loginAs(users.lead);
    await lead.getByRole("menuitem", { name: "Machines" }).click();
    await lead.getByRole("button", { name: "Add machine type" }).click();
    await lead.getByRole("dialog").getByLabel("Name").fill(type);
    await lead.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await expect(lead.getByRole("row", { name: new RegExp(type) })).toBeVisible();

    await lead.getByRole("button", { name: "Add machine", exact: true }).click();
    const dialog = lead.getByRole("dialog", { name: "Add machine" });
    await dialog.getByLabel("Name").fill(machine);
    await chooseOption(lead, "Type", type, dialog);
    await chooseOption(lead, "Branch", BASELINE.branch.name, dialog);
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(lead.getByRole("row", { name: new RegExp(machine) })).toContainText(BASELINE.branch.name);
  });

  test("a technician's doctor awaits approval; the lead approves", async ({ loginAs, users }) => {
    const name = uid("Dr");
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Referring doctors" }).click();
    await tech.getByRole("button", { name: "Add doctor" }).click();
    const dialog = tech.getByRole("dialog", { name: "Add doctor" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Clinic / hospital").fill("E2E Clinic");
    await dialog.getByRole("button", { name: "Add doctor" }).click();
    await expect(tech.getByRole("row", { name: new RegExp(name) })).toContainText("Awaiting approval");

    const lead = await loginAs(users.lead);
    await approveInQueue(lead, name);
    await lead.goto("/doctors");
    await expect(lead.getByRole("row", { name: new RegExp(name) })).toContainText("Approved");
  });
});

test.describe("Approval queue", () => {
  test("a pathologist rejects a discount with a note; the requester sees it", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ discountAmount: 30 });
    const path = await loginAs(users.path1);
    await path.getByRole("menuitem", { name: "Approval queue" }).click();
    const row = path.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toContainText("₹30.00");
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = path.getByRole("dialog", { name: "Reject request" });
    await expect(dialog).toContainText("The discount is reverted");
    await dialog.getByLabel("Note").fill("Not agreed");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(row).toBeHidden();
    expect((await techApi.getBill(bill.id)).discountAmount).toBe("0");

    const tech = await loginAs(users.tech1);
    await tech.goto("/requests");
    const mine = tech.getByRole("row", { name: new RegExp(bill.billNumber) }).first();
    await expect(mine).toContainText("Rejected");
    await expect(mine).toContainText("Not agreed");
  });

  test("bulk approval of selected requests; pathologists don't see catalog changes", async ({ loginAs, users, techApi }) => {
    const bills = [await techApi.createBill({ discountAmount: 10 }), await techApi.createBill({ discountAmount: 20 })];
    const c = code();
    await techApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code: c, name: "E2E hidden", kind: "test", price: 1 } }] });
    const path = await loginAs(users.path2);
    await path.goto("/approvals");
    await expect(path.getByRole("row", { name: new RegExp(c) })).toHaveCount(0);
    for (const b of bills) await path.getByRole("row", { name: new RegExp(b.billNumber) }).getByRole("checkbox").check();
    await path.getByRole("button", { name: "Approve selected" }).click();
    await expect(path.getByText("2 requests approved.")).toBeVisible();
    for (const b of bills) expect((await techApi.getBill(b.id)).holds).toEqual([]);
  });

  test("the lead resolves a rejected cancellation", async ({ loginAs, users, techApi, api }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    await techApi.cancel(bill, ["GLUF"]);
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_cancellation" });
    await (await api(users.path1)).decide(approval.id, "reject", "Should not have been cancelled");

    const lead = await loginAs(users.lead);
    await lead.goto("/approvals");
    const section = lead.getByRole("heading", { name: "Rejected cancellations to resolve" });
    await expect(section).toBeVisible();
    await lead.getByRole("row", { name: new RegExp(bill.billNumber) }).getByRole("button", { name: "Mark resolved" }).click();
    const dialog = lead.getByRole("dialog", { name: "Mark resolved" });
    await dialog.getByLabel("How it was resolved").fill("Billed again");
    await dialog.getByRole("button", { name: "Mark resolved" }).click();
    await expect(dialog).toBeHidden();
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);
  });
});
