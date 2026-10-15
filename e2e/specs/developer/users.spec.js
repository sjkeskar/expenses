// C1–C8: developer user lifecycle (create / promote / demote / deactivate).
const { test, expect } = require("../../fixtures");
const { DeveloperPage } = require("../../pages/developer");
const { LoginPage } = require("../../pages/login");
const { createUser, db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");

test.describe("Developer — user management", () => {
  let dev;
  test.beforeEach(async ({ loginAs, users }) => {
    dev = new DeveloperPage(await loginAs(users.dev));
  });

  for (const role of ["operator", "admin", "developer", "accountant"]) {
    test(`C1: creates a ${role}, who appears in the table and can log in`, async ({ browser }) => {
      const name = uid(`new-${role}`);
      const msg = await dev.createUser(name, "Fresh@123", role);
      expect(msg).toBe(`User "${name}" created as ${role}.`);
      await expect(dev.name).toHaveValue("");
      await expect(dev.password).toHaveValue("");

      const row = dev.userRow(name);
      await expect(row).toHaveCount(1);
      await expect(row.locator("td").nth(1)).toHaveText(role);
      await expect(row.locator("td").nth(2)).toHaveText("Active");

      const ctx = await browser.newContext();
      const login = new LoginPage(await ctx.newPage());
      await login.goto();
      await login.login(name, "Fresh@123");
      await expect(login.page).toHaveURL(new RegExp(`/${role}\\.html$`));
      await ctx.close();
    });
  }

  test("C1b: login name is trimmed on create", async () => {
    const name = uid("trim");
    await dev.createUser(`  ${name}  `, "Fresh@123", "operator");
    await expect(dev.userRow(name)).toHaveCount(1);
  });

  test("C2: a duplicate login name is rejected", async ({ users }) => {
    const msg = await dev.createUser(users.op1.name, "Fresh@123", "operator");
    expect(msg).toBe("A user with that name already exists.");
    await expect(dev.createMsg).toHaveClass(/error/);
  });

  for (const [bad, error] of [
    ["Ab#1", "Password must be at least 6 characters long."],
    ["Abcdef#", "Password must contain at least one number."],
    ["Abcdef1", "Password must contain at least one special character."],
  ]) {
    test(`C3: weak password "${bad}" is rejected`, async () => {
      const name = uid("weak");
      expect(await dev.createUser(name, bad, "operator")).toBe(error);
      expect(await db().user.findUnique({ where: { name } })).toBeNull();
    });
  }

  test("C4a: promote an operator to admin from the table", async () => {
    const op = await createUser("operator");
    await dev.page.reload({ waitUntil: "networkidle" });
    await dev.actionButton(op.name, "Promote to Admin").click();
    await expect(dev.actionMsg).toHaveText("User promoted to admin.");
    await expect(dev.userRow(op.name).locator("td").nth(1)).toHaveText("admin");
    await expect(dev.actionButton(op.name, "Demote to Operator")).toBeVisible();
    await expect(dev.actionButton(op.name, "Promote to Admin")).toHaveCount(0);
  });

  test("C4b: demote an admin to operator from the table", async () => {
    const admin = await createUser("admin");
    await dev.page.reload({ waitUntil: "networkidle" });
    await dev.actionButton(admin.name, "Demote to Operator").click();
    await expect(dev.actionMsg).toHaveText("User demoted to operator.");
    await expect(dev.userRow(admin.name).locator("td").nth(1)).toHaveText("operator");
  });

  test("C4c: developers and accountants get neither promote nor demote", async () => {
    const otherDev = await createUser("developer");
    const acct = await createUser("accountant");
    await dev.page.reload({ waitUntil: "networkidle" });
    for (const u of [otherDev, acct]) {
      await expect(dev.actionButton(u.name, "Promote to Admin")).toHaveCount(0);
      await expect(dev.actionButton(u.name, "Demote to Operator")).toHaveCount(0);
      await expect(dev.actionButton(u.name, "Deactivate")).toBeVisible();
    }
  });

  test("C5a: dismissing the deactivate confirm leaves the user active", async () => {
    const victim = await createUser("operator");
    await dev.page.reload({ waitUntil: "networkidle" });
    dev.page.once("dialog", (d) => d.dismiss());
    await dev.actionButton(victim.name, "Deactivate").click();
    await expect(dev.userRow(victim.name).locator("td").nth(2)).toHaveText("Active");
    expect((await db().user.findUnique({ where: { id: victim.id } })).isDeleted).toBe(false);
  });

  test("C5b: accepting the confirm deactivates the user, who can no longer log in", async ({ page }) => {
    const victim = await createUser("operator");
    await dev.page.reload({ waitUntil: "networkidle" });
    let dialogText = "";
    dev.page.once("dialog", (d) => {
      dialogText = d.message();
      d.accept();
    });
    await dev.actionButton(victim.name, "Deactivate").click();
    await expect(dev.actionMsg).toHaveText("User deactivated.");
    expect(dialogText).toContain("soft delete");

    const row = dev.userRow(victim.name);
    await expect(row.locator("td").nth(2)).toHaveText("Deactivated");
    await expect(row.locator("td").nth(4)).toHaveText("—"); // C7: no actions on deactivated users

    const stored = await db().user.findUnique({ where: { id: victim.id } });
    expect(stored.deletedAt).not.toBeNull();

    const login = new LoginPage(page);
    await login.goto();
    await login.login(victim.name, victim.password);
    await expect(login.msg).toHaveText("Invalid name or password.");
  });

  test("C6: there is no Deactivate button on your own row, and the API refuses it", async ({ users, api }) => {
    await expect(dev.actionButton(users.dev.name, "Deactivate")).toHaveCount(0);
    const self = await db().user.findUnique({ where: { name: users.dev.name } });
    const { status, body } = await (await api(users.dev)).raw("DELETE", `/users/${self.id}`);
    expect(status).toBe(400);
    expect(body.error).toBe("You cannot deactivate your own account.");
  });

  test("C8: deactivated users disappear from the admin Promote and Reassign pickers", async ({ api, users }) => {
    const op = await createUser("operator");
    const admin = await createUser("admin");
    for (const u of [op, admin]) {
      await db().user.update({ where: { id: u.id }, data: { isDeleted: true, deletedAt: new Date() } });
    }
    const adminApi = await api(users.admin);
    const { operators } = await adminApi.call("GET", "/users/operators");
    const { targets } = await adminApi.call("GET", "/users/reassign-targets");
    expect(operators.map((o) => o.name)).not.toContain(op.name);
    expect(targets.map((t) => t.name)).not.toContain(op.name);
    expect(targets.map((t) => t.name)).not.toContain(admin.name);
  });

  test("C8b: promote/demote/deactivate on an already-deactivated user returns 404", async ({ api, users }) => {
    const ghost = await createUser("operator");
    await db().user.update({ where: { id: ghost.id }, data: { isDeleted: true, deletedAt: new Date() } });
    const devApi = await api(users.dev);
    for (const [method, path] of [
      ["PATCH", `/users/${ghost.id}/promote`],
      ["PATCH", `/users/${ghost.id}/demote`],
      ["DELETE", `/users/${ghost.id}`],
    ]) {
      expect((await devApi.raw(method, path)).status, `${method} ${path}`).toBe(404);
    }
  });

  test("C4d: promote/demote reject the wrong starting role", async ({ api, users }) => {
    const admin = await createUser("admin");
    const op = await createUser("operator");
    const devApi = await api(users.dev);
    expect((await devApi.raw("PATCH", `/users/${admin.id}/promote`)).body.error).toBe(
      "Only an operator can be promoted to admin."
    );
    expect((await devApi.raw("PATCH", `/users/${op.id}/demote`)).body.error).toBe(
      "Only an admin can be demoted to operator."
    );
  });
});
