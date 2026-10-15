// B1–B6: the shared Change Password modal, on every role page. Always runs
// against a throwaway user so the seeded accounts keep their passwords.
const { test, expect, knownBug } = require("../../fixtures");
const { createUser } = require("../../helpers/db");
const { ChangePasswordModal } = require("../../pages/components");
const { LoginPage } = require("../../pages/login");

const ROLES = ["operator", "admin", "developer", "accountant"];
const NEW_PASSWORD = "Changed#42";

for (const role of ROLES) {
  test.describe(`Change Password on ${role}.html`, () => {
    test(`B1: ${role} changes password, is forced to re-login, old password stops working`, async ({ loginAs, page }) => {
      // BUG-001: on developer.html the modal reads the Create User form's
      // password field (duplicate id="new-password"), so this flow breaks.
      if (role === "developer") knownBug("BUG-001");

      const user = await createUser(role);
      const rolePage = await loginAs(user);
      const modal = new ChangePasswordModal(rolePage);
      await modal.change(user.password, NEW_PASSWORD);

      await expect(modal.msg).toContainText("Password changed");
      await expect(rolePage).toHaveURL(/login\.html$/, { timeout: 5000 });
      await expect(rolePage.locator("#msg")).toHaveText(
        "Your password was changed. Please log in with your new password."
      );

      const login = new LoginPage(page);
      await login.goto();
      await login.login(user.name, user.password);
      await expect(login.msg).toHaveText("Invalid name or password.");
      await login.login(user.name, NEW_PASSWORD);
      await expect(page).toHaveURL(new RegExp(`/${role}\\.html$`));
    });

    test(`B2: ${role} gets an error for a wrong current password`, async ({ loginAs }) => {
      if (role === "developer") knownBug("BUG-001");
      const user = await createUser(role);
      const modal = new ChangePasswordModal(await loginAs(user));
      await modal.change("Wrong@999", NEW_PASSWORD);
      await expect(modal.msg).toHaveText("Current password is incorrect.");
      await expect(modal.modal).toBeVisible();
    });

    test(`B3: ${role} gets an error when confirmation does not match`, async ({ loginAs }) => {
      const user = await createUser(role);
      const modal = new ChangePasswordModal(await loginAs(user));
      await modal.change(user.password, NEW_PASSWORD, "Different#1");
      await expect(modal.msg).toHaveText("New password and confirmation do not match.");
    });

    test(`B5: ${role} can cancel the modal (button and backdrop) and it is cleared`, async ({ loginAs }) => {
      const user = await createUser(role);
      const page = await loginAs(user);
      const modal = new ChangePasswordModal(page);

      await modal.open();
      await modal.current.fill("something");
      await modal.cancel.click();
      await expect(modal.modal).toBeHidden();
      await modal.open();
      await expect(modal.current).toHaveValue("");

      await modal.modal.click({ position: { x: 5, y: 5 } });
      await expect(modal.modal).toBeHidden();
    });
  });
}

test.describe("Password policy (B4)", () => {
  const CASES = [
    ["Ab#1", "Password must be at least 6 characters long."],
    ["Abcdef#", "Password must contain at least one number."],
    ["Abcdef1", "Password must contain at least one special character."],
  ];
  for (const [bad, error] of CASES) {
    test(`B4: "${bad}" is rejected — ${error}`, async ({ loginAs }) => {
      const user = await createUser("operator");
      const modal = new ChangePasswordModal(await loginAs(user));
      await modal.change(user.password, bad);
      await expect(modal.msg).toHaveText(error);
    });
  }

  test("B4b: the minimum valid password (6 chars, 1 number, 1 special) is accepted", async ({ loginAs }) => {
    const user = await createUser("operator");
    const modal = new ChangePasswordModal(await loginAs(user));
    await modal.change(user.password, "abcd1!");
    await expect(modal.msg).toContainText("Password changed");
  });
});
