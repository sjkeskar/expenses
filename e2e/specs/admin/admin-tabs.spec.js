// H1–H11: admin-only tabs — Promote, Reassign Operator, Locations, Categories.
const { test, expect } = require("../../fixtures");
const { AdminPage } = require("../../pages/admin");
const { createUser, db, findBillByNumber } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");

const TABS = ["billing", "analytics", "promote", "reassign", "locations", "categories"];

test.describe("Admin tabs", () => {
  let admin;
  let ui;
  test.beforeEach(async ({ loginAs }) => {
    admin = await createUser("admin");
    ui = new AdminPage(await loginAs(admin));
  });

  test("H0: each tab shows its own section and hides the others", async () => {
    for (const tab of TABS) {
      await ui.openTab(tab);
      await expect(ui.tabButton(tab)).toHaveClass(/active/);
      for (const other of TABS.filter((t) => t !== tab)) {
        await expect(ui.page.locator(`#tab-${other}`)).toBeHidden();
      }
    }
  });

  test.describe("Promote Operator", () => {
    test("H1: lists active operators only, promotes one, and removes them from the list", async () => {
      const op = await createUser("operator");
      const gone = await createUser("operator");
      await db().user.update({ where: { id: gone.id }, data: { isDeleted: true, deletedAt: new Date() } });
      const otherAdmin = await createUser("admin");

      await ui.openTab("promote");
      const options = await ui.promote.select.locator("option").allTextContents();
      expect(options).toContain(op.name);
      expect(options).not.toContain(gone.name);
      expect(options).not.toContain(otherAdmin.name);

      await ui.promote.select.selectOption({ label: op.name });
      await ui.promote.submit.click();
      await expect(ui.promote.msg).toHaveText(`${op.name} promoted to admin.`);
      await expect(ui.promote.select.locator("option", { hasText: op.name })).toHaveCount(0);
      expect((await db().user.findUnique({ where: { id: op.id } })).role).toBe("admin");
    });
  });

  test.describe("Reassign Operator", () => {
    test("H2: picker covers all bills; targets are active operators and admins only", async ({ adminApi }) => {
      const paid = await adminApi.createBill({ initialAmountCollected: 1000 });
      const refunded = await adminApi.createBill({ initialAmountCollected: 10 });
      await adminApi.refund(refunded.id);
      const op = await createUser("operator");
      const acct = await createUser("accountant");
      const dev = await createUser("developer");

      await ui.openTab("reassign");
      for (const bill of [paid, refunded]) {
        await ui.reassign.bill.input.fill(bill.billNumber);
        await expect(ui.reassign.bill.item(`${bill.billNumber} — ${bill.client.name}`)).toHaveCount(1);
      }
      const targets = await ui.reassign.target.locator("option").allTextContents();
      expect(targets).toContain(`${op.name} (operator)`);
      expect(targets).toContain(`${admin.name} (admin)`);
      expect(targets.join()).not.toContain(acct.name);
      expect(targets.join()).not.toContain(dev.name);
      await expect(ui.reassign.historyEmpty).toHaveText("Select a bill above to see its full reassignment history.");
    });

    test("H2b: submitting without picking a bill shows an error", async () => {
      await ui.openTab("reassign");
      await ui.reassign.bill.type("nonsense");
      await ui.reassign.submit.click();
      await expect(ui.reassign.msg).toHaveText("Pick a bill from the dropdown first.");
    });

    test("H2c/H3: dismissing the confirm does nothing; A→B→C keeps full history and payment attribution", async ({ api }) => {
      const a = await createUser("operator");
      const b = await createUser("operator");
      const c = await createUser("admin");
      const bill = await (await api(a)).createBill({ originalAmount: 500, initialAmountCollected: 200 });

      await ui.openTab("reassign");
      await ui.reassign.bill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
      await expect(ui.reassign.historyEmpty).toHaveText("This bill has never been reassigned.");
      await expect(ui.reassign.bill.dropdown).toBeHidden();

      ui.page.once("dialog", (d) => d.dismiss());
      await ui.reassign.target.selectOption({ label: `${b.name} (operator)` });
      await ui.reassign.submit.click();
      expect((await findBillByNumber(bill.billNumber)).createdById).toBe(a.id);

      for (const [target, label] of [[b, "operator"], [c, "admin"]]) {
        let dialogText = "";
        ui.page.once("dialog", (d) => {
          dialogText = d.message();
          d.accept();
        });
        await ui.reassign.bill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
        await ui.reassign.target.selectOption({ label: `${target.name} (${label})` });
        await ui.reassign.submit.click();
        await expect(ui.reassign.msg).toHaveText(`Bill ${bill.billNumber} reassigned to ${target.name}.`);
        expect(dialogText).toContain(`Reassign this bill to ${target.name}?`);
      }

      const history = await ui.reassignHistoryRows();
      expect(history.map((r) => r.slice(1))).toEqual([
        [a.name, b.name, admin.name],
        [b.name, c.name, admin.name],
      ]);

      const stored = await findBillByNumber(bill.billNumber);
      expect(stored.createdById).toBe(c.id);
      expect(stored.reassignments).toHaveLength(2);
      expect(stored.transactions[0].operatorId).toBe(a.id); // H3: payment stays with who took it
    });

    test("H4: reassigning to the current owner is rejected", async ({ api }) => {
      const op = await createUser("operator");
      const bill = await (await api(op)).createBill();
      await ui.openTab("reassign");
      ui.page.once("dialog", (d) => d.accept());
      await ui.reassign.bill.pick(bill.billNumber, `${bill.billNumber} — ${bill.client.name}`);
      await ui.reassign.target.selectOption({ label: `${op.name} (operator)` });
      await ui.reassign.submit.click();
      await expect(ui.reassign.msg).toHaveText("This bill is already assigned to that operator.");
    });

    test("H5: a legacy bill with no creator can be reassigned; history shows it as unattributed", async () => {
      const op = await createUser("operator");
      const client = await db().client.create({ data: { name: uid("Legacy") } });
      const billNumber = `99${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
      await db().bill.create({
        data: { billNumber, clientId: client.id, originalAmount: 50, netAmount: 50, balance: 50 },
      });

      await ui.openTab("reassign");
      await expect(async () => {
        await ui.reassign.bill.input.fill(billNumber);
        await expect(ui.reassign.bill.item(`${billNumber} — ${client.name}`)).toContainText(
          "Current operator: Unattributed (legacy bill)",
          { timeout: 1000 }
        );
      }).toPass({ timeout: 10_000 });
      ui.page.once("dialog", (d) => d.accept());
      await ui.reassign.bill.pick(billNumber, `${billNumber} — ${client.name}`);
      await ui.reassign.target.selectOption({ label: `${op.name} (operator)` });
      await ui.reassign.submit.click();
      await expect(ui.reassign.msg).toHaveText(`Bill ${billNumber} reassigned to ${op.name}.`);
      const [row] = await ui.reassignHistoryRows();
      expect(row.slice(1)).toEqual(["Unattributed (legacy bill)", op.name, admin.name]);
    });

    test("H5b: the API rejects deactivated or non-billing target users", async ({ adminApi }) => {
      const bill = await adminApi.createBill();
      const gone = await createUser("operator");
      await db().user.update({ where: { id: gone.id }, data: { isDeleted: true } });
      const acct = await createUser("accountant");
      expect((await adminApi.raw("PATCH", `/bills/${bill.id}/reassign-operator`, { operatorId: gone.id })).body.error)
        .toBe("Target user not found or is deactivated.");
      expect((await adminApi.raw("PATCH", `/bills/${bill.id}/reassign-operator`, { operatorId: acct.id })).body.error)
        .toBe("Target user must be an operator or admin.");
    });
  });

  test.describe("Locations", () => {
    test("H6: adds a location that then appears in the table and in the bill form", async () => {
      await ui.openTab("locations");
      const name = uid("Branch");
      expect(await ui.addLocation(`  ${name} `, "04")).toBe(`Location "${name}" (code 04) added.`);
      await expect(ui.locations.name).toHaveValue("");
      await expect(ui.locationRow(name).locator("td").nth(1)).toHaveText("04");

      await ui.openTab("billing");
      await ui.location.input.fill(name);
      await expect(ui.location.item(name)).toHaveCount(1);
      await expect(ui.location.dropdown).toContainText("Code: 04");
    });

    test("H6b: the 2-digit code is enforced by the form and the API", async ({ adminApi }) => {
      await ui.openTab("locations");
      await ui.locations.name.fill(uid("BadCode"));
      for (const bad of ["4", "ab"]) {
        await ui.locations.code.fill(bad);
        await ui.locations.submit.click();
        expect(await ui.locations.code.evaluate((el) => el.validity.valid), bad).toBe(false);
      }
      for (const bad of ["4", "ab", "123", "", " 1"]) {
        const { status, body } = await adminApi.raw("POST", "/locations", { name: uid("Bad"), locationCode: bad });
        expect(status, JSON.stringify(bad)).toBe(400);
        expect(body.error).toBe("Location code must be exactly 2 digits (e.g. 04).");
      }
    });

    test("H6c: a duplicate name (any case) is rejected; a blank name is rejected by the API", async ({ adminApi }) => {
      await ui.openTab("locations");
      const msg = await ui.addLocation(BASELINE.location.name.toUpperCase(), "05");
      expect(msg).toBe("A location with that name already exists.");
      const { status, body } = await adminApi.raw("POST", "/locations", { name: "   ", locationCode: "05" });
      expect(status).toBe(400);
      expect(body.error).toBe("Location name is required.");
    });

    test("H7/H8: delete (with confirm) hides it from new bills but keeps it on old bills; re-adding revives it", async ({ adminApi }) => {
      const loc = await adminApi.addLocation({ locationCode: "06" });
      const oldBill = await adminApi.createBill({ locationId: loc.id });
      await ui.openTab("locations");

      ui.page.once("dialog", (d) => d.dismiss());
      await ui.locationRow(loc.name).getByRole("button", { name: "Delete" }).click();
      await expect(ui.locationRow(loc.name)).toHaveCount(1);

      ui.page.once("dialog", (d) => d.accept());
      await ui.locationRow(loc.name).getByRole("button", { name: "Delete" }).click();
      await expect(ui.locations.actionMsg).toHaveText("Location deleted.");
      await expect(ui.locationRow(loc.name)).toHaveCount(0);

      await ui.openTab("billing");
      await ui.location.input.fill(loc.name);
      await expect(ui.location.items).toHaveCount(0);
      const stored = await adminApi.getBill(oldBill.id);
      expect(stored.location.name).toBe(loc.name);

      await ui.openTab("locations");
      expect(await ui.addLocation(loc.name, "07")).toBe(`Location "${loc.name}" (code 07) added.`);
      const revived = await db().location.findMany({ where: { name: loc.name } });
      expect(revived).toHaveLength(1);
      expect(revived[0]).toMatchObject({ id: loc.id, isActive: true, locationCode: "07" });
    });
  });

  test.describe("Categories", () => {
    test("H9/H10: standard category; company field only shown for credit", async () => {
      await ui.openTab("categories");
      await expect(ui.categories.companyField).toBeHidden();
      await ui.categories.type.selectOption("credit");
      await expect(ui.categories.companyField).toBeVisible();
      await ui.categories.company.type("leftover");
      await ui.categories.type.selectOption("standard");
      await expect(ui.categories.companyField).toBeHidden();
      await expect(ui.categories.company.input).toHaveValue("");

      const name = uid("Std");
      expect(await ui.addCategory({ name })).toBe(`Category "${name}" (standard) added.`);
      const row = ui.categoryRow(name).locator("td");
      await expect(row.nth(1)).toHaveText("standard");
      await expect(row.nth(2)).toHaveText("—");
    });

    test("H9b: a credit category requires a company", async () => {
      await ui.openTab("categories");
      await ui.categories.name.fill(uid("NoCo"));
      await ui.categories.type.selectOption("credit");
      await ui.categories.submit.click();
      await expect(ui.categories.msg).toHaveText("Enter a company name for this credit category.");
    });

    test("H9c: a new company name creates the company and makes it settle-able", async () => {
      await ui.openTab("categories");
      const name = uid("Cr");
      const company = uid("NewCo");
      expect(await ui.addCategory({ name, type: "credit", company })).toBe(
        `Category "${name}" (credit) (${company}) added.`
      );
      await expect(ui.categoryRow(name).locator("td").nth(2)).toHaveText(company);
      expect(await db().company.count({ where: { name: company } })).toBe(1);

      await ui.openTab("billing");
      await ui.settleCompany.input.fill(company);
      await expect(ui.settleCompany.item(company)).toHaveCount(1);
    });

    test("H9d: an existing company (typed in another case, or picked) is linked, not duplicated", async ({ adminApi }) => {
      const { company } = await adminApi.addCreditCategory();
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.openTab("categories");

      const typed = uid("Typed");
      await ui.addCategory({ name: typed, type: "credit", company: company.name.toUpperCase() });
      const picked = uid("Picked");
      await ui.categories.type.selectOption("credit");
      await ui.addCategory({ name: picked, type: "credit", company: company.name, pickCompany: true });

      expect(await db().company.count({ where: { name: { equals: company.name, mode: "insensitive" } } })).toBe(1);
      for (const n of [typed, picked]) {
        expect((await db().category.findFirst({ where: { name: n } })).companyId).toBe(company.id);
      }
    });

    test("H9e: a duplicate category name (any case) is rejected", async () => {
      await ui.openTab("categories");
      expect(await ui.addCategory({ name: BASELINE.standardCategory.name.toLowerCase() })).toBe(
        "A category with that name already exists."
      );
    });

    test("H11: delete keeps the company and old bills; re-adding revives with the new type", async ({ adminApi }) => {
      const { category, company } = await adminApi.addCreditCategory();
      const oldBill = await adminApi.createBill({ categoryId: category.id });
      await ui.page.reload({ waitUntil: "networkidle" });
      await ui.openTab("categories");

      ui.page.once("dialog", (d) => d.accept());
      await ui.categoryRow(category.name).getByRole("button", { name: "Delete" }).click();
      await expect(ui.categories.actionMsg).toHaveText("Category deleted.");
      await expect(ui.categoryRow(category.name)).toHaveCount(0);

      await ui.openTab("billing");
      await ui.category.input.fill(category.name);
      await expect(ui.category.items).toHaveCount(0);
      await ui.settleCompany.input.fill(company.name);
      await expect(ui.settleCompany.item(company.name)).toHaveCount(1);
      expect((await adminApi.getBill(oldBill.id)).category.name).toBe(category.name);

      await ui.openTab("categories");
      await ui.addCategory({ name: category.name, type: "standard" });
      const revived = await db().category.findUnique({ where: { id: category.id } });
      expect(revived).toMatchObject({ isActive: true, type: "standard", companyId: null });
    });
  });
});
