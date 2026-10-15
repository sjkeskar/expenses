// A1–A9: login, logout, redirects and role-page guards.
const { test, expect, knownBug } = require("../../fixtures");
const { LoginPage } = require("../../pages/login");
const { db, createUser } = require("../../helpers/db");

const ROLES = ["operator", "admin", "developer", "accountant"];
const ROLE_USER = { operator: "op1", admin: "admin", developer: "dev", accountant: "acct" };

test.describe("Login", () => {
  for (const role of ROLES) {
    test(`A1: ${role} logs in through the form and lands on ${role}.html`, async ({ page, users }) => {
      const user = users[ROLE_USER[role]];
      const login = new LoginPage(page);
      await login.goto();
      await login.login(user.name, user.password);
      await expect(page).toHaveURL(new RegExp(`/${role}\\.html$`));
      await expect(page.locator("#user-name")).toHaveText(`${user.name} (${role})`);
    });
  }

  test("A2: wrong password, unknown user and deactivated user all get the same generic error", async ({ page, users }) => {
    const deactivated = await createUser("operator");
    await db().user.update({ where: { id: deactivated.id }, data: { isDeleted: true, deletedAt: new Date() } });

    const login = new LoginPage(page);
    await login.goto();
    for (const [name, password] of [
      [users.op1.name, "Wrong@123"],
      ["no-such-user-xyz", "Test@123"],
      [deactivated.name, deactivated.password],
    ]) {
      await login.login(name, password);
      await expect(login.msg).toHaveText("Invalid name or password.");
      await expect(login.msg).toHaveClass(/error/);
      await expect(page).toHaveURL(/login\.html$/);
    }
  });

  test("A2b: login name is case-sensitive", async ({ page, users }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(users.op1.name.toUpperCase(), users.op1.password);
    await expect(login.msg).toHaveText("Invalid name or password.");
  });

  test("A2c: surrounding whitespace in the login name is trimmed", async ({ page, users }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(`  ${users.op1.name}  `, users.op1.password);
    await expect(page).toHaveURL(/operator\.html$/);
  });

  test("A3: empty fields are blocked by browser validation (no request sent)", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    let called = false;
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/login")) called = true;
    });
    await login.submit.click();
    expect(await login.name.evaluate((el) => el.validity.valueMissing)).toBe(true);
    await login.name.fill("someone");
    await login.submit.click();
    expect(await login.password.evaluate((el) => el.validity.valueMissing)).toBe(true);
    expect(called).toBe(false);
  });

  test("A4: visiting the login page while logged in redirects to the role page", async ({ loginAs, users }) => {
    const page = await loginAs(users.admin);
    await page.goto("/login.html");
    await expect(page).toHaveURL(/admin\.html$/);
  });

  test("A5: the site root redirects to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/login\.html$/);
  });

  for (const role of ROLES) {
    test(`A6: ${role}.html redirects to login when not logged in`, async ({ page }) => {
      await page.goto(`/${role}.html`);
      await expect(page).toHaveURL(/login\.html$/);
    });
  }

  test("A9: session reminder banner is shown after logging in through the form", async ({ page, users }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(users.op1.name, users.op1.password);
    await expect(page.locator("#reminder")).toBeVisible();
    await expect(page.locator("#reminder")).toContainText("4 hours");
  });
});

test.describe("Role page guards", () => {
  for (const actual of ROLES) {
    for (const visited of ROLES.filter((r) => r !== actual)) {
      test(`A7: ${actual} opening ${visited}.html is sent back to ${actual}.html`, async ({ loginAs, users }) => {
        const page = await loginAs(users[ROLE_USER[actual]]);
        await page.goto(`/${visited}.html`);
        await expect(page).toHaveURL(new RegExp(`/${actual}\\.html$`));
      });
    }
  }
});

test.describe("Logout", () => {
  for (const role of ROLES) {
    test(`A8: ${role} logs out and the session is destroyed`, async ({ loginAs, users }) => {
      const page = await loginAs(users[ROLE_USER[role]]);
      await page.locator("#logout-btn").click();
      await expect(page).toHaveURL(/login\.html$/);

      const me = await page.request.get("/api/auth/me");
      expect(me.status()).toBe(401);
    });

    test(`A8b: ${role} pressing Back after logout is sent to the login page`, async ({ loginAs, users }) => {
      knownBug("BUG-007");
      const page = await loginAs(users[ROLE_USER[role]]);
      await page.locator("#logout-btn").click();
      await expect(page).toHaveURL(/login\.html$/);

      await page.goBack();
      await expect(page).toHaveURL(/login\.html$/);
    });
  }
});
