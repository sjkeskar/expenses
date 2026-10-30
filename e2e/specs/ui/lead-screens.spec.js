// The lead's screens: users, branches & centres, lab settings; and the
// developer's setup page once the lab is set up.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption: choose } = require("../../helpers/ui");

test.describe("Users", () => {
  test("the lead adds a technician who can then sign in", async ({ loginAs, users, page }) => {
    const lead = await loginAs(users.lead);
    await lead.getByRole("menuitem", { name: "Users" }).click();
    await lead.getByRole("button", { name: "Add user" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add user" });
    const name = uid("tech");
    await dialog.getByLabel("Login name").fill(name);
    await choose(lead, "Role", "Technician");
    await dialog.getByLabel("Password", { exact: true }).fill("Start@123");
    await dialog.getByLabel("Confirm password").fill("Start@123");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: new RegExp(name) })).toContainText("Technician");

    await page.goto("/login");
    await page.getByLabel("Login name").fill(name);
    await page.getByLabel("Password").fill("Start@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
  });

  test("a duplicate name is reported inside the dialog", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/users");
    await lead.getByRole("button", { name: "Add user" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add user" });
    await dialog.getByLabel("Login name").fill(users.tech1.name);
    await choose(lead, "Role", "Technician");
    await dialog.getByLabel("Password", { exact: true }).fill("Start@123");
    await dialog.getByLabel("Confirm password").fill("Start@123");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("A user with that name already exists.");
  });

  test("the lead resets a password and deactivates an account", async ({ loginAs, users }) => {
    const user = await createUser("technician");
    const lead = await loginAs(users.lead);
    await lead.goto("/users");
    const row = lead.getByRole("row", { name: new RegExp(user.name) });

    await row.getByRole("button", { name: "Reset password" }).click();
    const dialog = lead.getByRole("dialog", { name: `Reset ${user.name}'s password` });
    await dialog.getByLabel("New password", { exact: true }).fill("Reset@123");
    await dialog.getByLabel("Confirm new password").fill("Reset@123");
    await dialog.getByRole("button", { name: "Reset password" }).click();
    await expect(dialog).toBeHidden();

    await row.getByRole("button", { name: "Deactivate" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Deactivate" }).click();
    await expect(row).toContainText("Deactivated");
    await expect(row.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    expect((await db().user.findUnique({ where: { id: user.id } })).isDeleted).toBe(true);
  });

  test("the lead's and the developer's rows have no actions", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/users");
    for (const name of [users.lead.name, users.dev.name]) {
      await expect(lead.getByRole("row", { name: new RegExp(`^${name}`) }).getByRole("button")).toHaveCount(0);
    }
  });
});

test.describe("Branches & centres", () => {
  test("add a branch with home visits, a centre processed there, then edit and remove", async ({ loginAs, users, leadApi }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/locations");
    const branchName = uid("Branch");
    // A free code: the helper finds one the same way.
    const probe = await leadApi.addLocation();
    await leadApi.call("DELETE", `/locations/${probe.id}`);
    const used = new Set((await db().location.findMany()).map((l) => l.locationCode));
    const free = () => [...Array(90).keys()].map((n) => String(n + 10)).find((c) => !used.has(c) && used.add(c));

    await lead.getByRole("button", { name: "Add location" }).click();
    let dialog = lead.getByRole("dialog", { name: "Add location" });
    await dialog.getByLabel("Name").fill(branchName);
    await dialog.getByLabel("Location code").fill(free());
    await dialog.getByLabel("Address").fill("10 Test Road");
    await dialog.getByLabel("Offers home visits").click();
    await dialog.getByLabel("Home-visit charge (minimum)").fill("250");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: new RegExp(branchName) })).toContainText("From ₹250.00");

    const centreName = uid("Centre");
    await lead.getByRole("button", { name: "Add location" }).click();
    dialog = lead.getByRole("dialog", { name: "Add location" });
    await dialog.getByLabel("Name").fill(centreName);
    await dialog.getByLabel("Collection centre").check();
    await dialog.getByLabel("Location code").fill(free());
    await choose(lead, "Samples processed at", branchName);
    await dialog.getByLabel("Address").fill("11 Test Road");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByRole("row", { name: new RegExp(centreName) })).toContainText(branchName);

    // Anchored: the centre's row also mentions the branch (where its samples go).
    const branchRow = lead.getByRole("row", { name: new RegExp(`^${branchName} `) });
    await branchRow.getByRole("button", { name: "Edit" }).click();
    dialog = lead.getByRole("dialog", { name: `Edit ${branchName}` });
    await expect(dialog.getByLabel("Location code")).toBeDisabled();
    await dialog.getByLabel("Offers home visits").click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(branchRow).toContainText("Not offered");

    // A branch still processing a centre's samples can't be removed.
    await branchRow.getByRole("button", { name: "Remove" }).click();
    await lead.getByRole("tooltip").getByRole("button", { name: "Remove" }).click();
    await expect(lead.getByText(/still processes samples/)).toBeVisible();
  });

  test("the lead turns a branch into a collection centre, processed at another branch", async ({ loginAs, users, leadApi }) => {
    const [branch, processor] = [await leadApi.addLocation(), await leadApi.addLocation()];
    const lead = await loginAs(users.lead);
    await lead.goto("/locations");
    const row = lead.getByRole("row", { name: new RegExp(`^${branch.name} `) });
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = lead.getByRole("dialog", { name: `Edit ${branch.name}` });
    await expect(dialog).toContainText("It can become a collection centre once it has no machines");
    await dialog.getByLabel("Collection centre").check();
    await choose(lead, "Samples processed at", processor.name);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Collection centre");
    await expect(row).toContainText(processor.name);
  });

  test("a branch with machines can't become a centre; the dialog says why", async ({ loginAs, users, leadApi }) => {
    const [branch, processor] = [await leadApi.addLocation(), await leadApi.addLocation()];
    const machineTypeId = (await db().machineType.findUnique({ where: { name: BASELINE.machineType } })).id;
    await leadApi.call("POST", "/machines", { name: uid("Unit"), machineTypeId, branchId: branch.id });
    const lead = await loginAs(users.lead);
    await lead.goto("/locations");
    await lead.getByRole("row", { name: new RegExp(`^${branch.name} `) }).getByRole("button", { name: "Edit" }).click();
    const dialog = lead.getByRole("dialog", { name: `Edit ${branch.name}` });
    await dialog.getByLabel("Collection centre").check();
    await choose(lead, "Samples processed at", processor.name);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("still has machines");
  });

  test("a code in use is reported inside the dialog", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/locations");
    await lead.getByRole("button", { name: "Add location" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add location" });
    await dialog.getByLabel("Name").fill(uid("Branch"));
    await dialog.getByLabel("Location code").fill(BASELINE.branch.locationCode);
    await dialog.getByLabel("Address").fill("x");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(`Location code ${BASELINE.branch.locationCode} is already in use.`);
  });
});

test.describe("Lab settings", () => {
  test("required fields are checked", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/settings");
    await lead.getByLabel("Lab name").fill("");
    await lead.getByRole("button", { name: "Save" }).click();
    await expect(lead.getByText("Enter the lab's name")).toBeVisible();
  });
});

test.describe("Developer", () => {
  test("once the lab is set up, the setup page shows it and the lead, and refuses early re-appointment", async ({ loginAs, users }) => {
    const dev = await loginAs(users.dev);
    await dev.getByRole("menuitem", { name: "Lab setup" }).click();
    const main = dev.getByRole("main");
    await expect(main.getByText(BASELINE.settings.labName, { exact: true })).toBeVisible();
    await expect(main.getByText(users.lead.name, { exact: true })).toBeVisible();
    await expect(dev.getByText(/only after the lead hasn't signed in for 7 days/)).toBeVisible();
    await expect(dev.getByRole("button", { name: "Appoint as lead" })).toHaveCount(0);
  });
});
