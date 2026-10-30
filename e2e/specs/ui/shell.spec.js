// Signing in and out, the route guards, the role-based menu, and changing
// your own password — the shell every screen sits in.
const { test, expect } = require("../../fixtures");
const { accountMenu } = require("../../helpers/ui");
const { createUser } = require("../../helpers/db");

test.describe("Signing in and out", () => {
  test("a wrong password shows the generic error; the right one opens Home", async ({ page, users }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Login name").fill(users.tech1.name);
    await page.getByLabel("Password").fill("Wrong@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid name or password.");

    await page.getByLabel("Password").fill(users.tech1.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: `Welcome, ${users.tech1.name}` })).toBeVisible();
    // The session reminder shows once and can be dismissed.
    await expect(page.getByText("Your session stays active for 4 hours")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Your session stays active for 4 hours")).toBeHidden();
  });

  test("the login name is trimmed and empty fields are caught before sending", async ({ page, users }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your login name")).toBeVisible();
    await page.getByLabel("Login name").fill(`  ${users.tech1.name}  `);
    await page.getByLabel("Password").fill(users.tech1.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: `Welcome, ${users.tech1.name}` })).toBeVisible();
  });

  test("a deep link survives signing in", async ({ page, users }) => {
    await page.goto("/locations");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Login name").fill(users.lead.name);
    await page.getByLabel("Password").fill(users.lead.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/locations$/);
  });

  test("signing out returns to login, and Back doesn't show the app again (BUG-007)", async ({ loginAs, users }) => {
    const page = await loginAs(users.lead);
    await page.getByRole("menuitem", { name: "Users" }).click();
    await expect(page).toHaveURL(/\/users$/);
    await accountMenu(page, "Sign out");
    await expect(page).toHaveURL(/\/login$/);
    // Back lands on an earlier screen of the signed-in session; it must re-check and send us to login.
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("the old page URLs redirect into the app", async ({ page }) => {
    await page.goto("/operator.html");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/login.html");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("Roles", () => {
  // Group headings are menu items too: they fold their group open and shut.
  const RECEPTION = ["Reception", "Patients", "Quotations", "Bills", "Sample revisits", "Day sheet", "Panel settlement", "Verify document"];
  const MENUS = {
    lead: ["Home", ...RECEPTION, "Catalog", "Tests & profiles", "Referring doctors", "Machines", "Approvals", "Approval queue", "My requests", "Reports", "Analytics", "Administration", "Panels & camps", "Branches & centres", "Users", "Lab settings"],
    path1: ["Home", ...RECEPTION, "Catalog", "Tests & profiles", "Referring doctors", "Approvals", "Approval queue", "My requests"],
    tech1: ["Home", ...RECEPTION, "Catalog", "Tests & profiles", "Referring doctors", "Approvals", "My requests"],
    acct: ["Home", "Reception", "Bills", "Day sheet", "Verify document", "Catalog", "Tests & profiles", "Reports", "Analytics"],
    dev: ["Home", "Administration", "Lab setup"],
  };
  for (const [key, items] of Object.entries(MENUS)) {
    test(`${key} sees exactly their menu`, async ({ loginAs, users }) => {
      const page = await loginAs(users[key]);
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("menuitem")).toHaveText(items);
    });
  }

  test("the quick access bar: front-desk actions for technicians, the approval queue for pathologists", async ({ loginAs, users }) => {
    const bar = (page) => page.getByRole("navigation", { name: "Quick access" }).getByRole("button");
    await expect(bar(await loginAs(users.tech1))).toHaveText(["New bill", "New quotation", "Register patient"]);
    await expect(bar(await loginAs(users.path1))).toHaveAccessibleName(/^Approval queue, \d+ waiting$/);
    await expect(bar(await loginAs(users.lead))).toHaveCount(1);
    await expect(bar(await loginAs(users.acct))).toHaveCount(0);
  });

  test("Alt+B, Alt+Q and Alt+P start a bill, a quotation or a registration from any screen", async ({ loginAs, users }) => {
    const page = await loginAs(users.path1); // the shortcuts work for anyone doing reception work
    await page.goto("/catalog");
    await page.getByRole("heading", { name: "Tests & profiles" }).waitFor();
    await page.keyboard.press("Alt+B");
    await expect(page).toHaveURL(/\/bills\/new$/);
    await page.keyboard.press("Alt+Q");
    await expect(page).toHaveURL(/\/quotations\/new$/);
    await page.keyboard.press("Alt+P");
    await expect(page.getByRole("dialog", { name: "Register patient" })).toBeVisible();
  });

  test("a menu group folds shut, and stays so on this PC", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    const nav = page.getByRole("navigation", { name: "Main" });
    const catalog = nav.getByRole("menuitem", { name: "Catalog" });
    await expect(catalog).toHaveAttribute("aria-expanded", "true");
    await catalog.click();
    await expect(catalog).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("menuitem", { name: "Tests & profiles" })).toBeHidden();
    await page.reload();
    await expect(nav.getByRole("menuitem", { name: "Catalog" })).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("menuitem", { name: "Patients" })).toBeVisible(); // the other groups stay open
  });

  test("the side menu collapses to its icons, and stays so on this PC", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    const nav = page.getByRole("navigation", { name: "Main" });
    expect((await nav.boundingBox()).width).toBeGreaterThan(200);
    await page.getByRole("button", { name: "Collapse the menu" }).click();
    await expect(page.getByRole("button", { name: "Expand the menu" })).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await nav.boundingBox()).width).toBeLessThan(80);
    await nav.getByRole("menuitem").nth(1).click(); // icons still navigate, one click each
    await expect(page).toHaveURL(/\/patients$/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand the menu" })).toBeVisible();
    await page.getByRole("button", { name: "Expand the menu" }).click();
    await expect.poll(async () => (await nav.boundingBox()).width).toBeGreaterThan(200);
  });

  test("a screen for another role sends you Home", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    await page.goto("/users");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: `Welcome, ${users.tech1.name}` })).toBeVisible();
  });

  test("a deactivated user is sent to login on their next action", async ({ loginAs, leadApi }) => {
    const user = await createUser("technician");
    const page = await loginAs(user);
    await leadApi.call("DELETE", `/users/${user.id}`);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("Changing your own password", () => {
  test("checks the policy and the confirmation, then signs you out", async ({ loginAs }) => {
    const user = await createUser("technician");
    const page = await loginAs(user);
    await accountMenu(page, "Change password");
    const dialog = page.getByRole("dialog", { name: "Change password" });
    await dialog.getByLabel("Current password").fill(user.password);
    await dialog.getByLabel("New password", { exact: true }).fill("short");
    await dialog.getByLabel("Confirm new password").fill("different");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("At least 6 characters")).toBeVisible();
    await expect(dialog.getByText("The passwords don't match")).toBeVisible();

    await dialog.getByLabel("New password", { exact: true }).fill("Better@123");
    await dialog.getByLabel("Confirm new password").fill("Better@123");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Password changed")).toBeVisible();
  });

  test("a wrong current password is reported inside the dialog", async ({ loginAs }) => {
    const user = await createUser("technician");
    const page = await loginAs(user);
    await accountMenu(page, "Change password");
    const dialog = page.getByRole("dialog", { name: "Change password" });
    await dialog.getByLabel("Current password").fill("Wrong@123");
    await dialog.getByLabel("New password", { exact: true }).fill("Better@123");
    await dialog.getByLabel("Confirm new password").fill("Better@123");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Current password is incorrect.");
  });
});
