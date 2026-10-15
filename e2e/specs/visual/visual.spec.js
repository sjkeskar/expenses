// M1: visual regression snapshots of every page and key UI state.
//
// The pages are the real static files served by the app, but every /api
// call is answered with fixed data (helpers/mock-api.js) and the browser
// clock is frozen, so screenshots are deterministic. Baselines live in
// e2e/__screenshots__/ and are platform-specific; after an intentional UI
// change, review the diff in the HTML report and refresh them with
// `npm run test:e2e:update-snapshots`.
const { test: base, expect } = require("@playwright/test");
const { mockApi, FROZEN_NOW } = require("../../helpers/mock-api");
const { Combobox } = require("../../pages/components");

const test = base.extend({
  // Opens /<role>.html (or login) with mocked data and a frozen clock.
  open: async ({ page }, use) => {
    await use(async (role) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.clock.setFixedTime(FROZEN_NOW);
      await mockApi(page, role);
      await page.goto(role ? `/${role}.html` : "/login.html", { waitUntil: "networkidle" });
      if (role) await expect(page.locator("#user-name")).not.toBeEmpty();
      return page;
    });
  },
});

const shot = (page, name) => expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
// Fixed-position overlays (modals) are captured at viewport size: full-page
// capture would leave the overlay covering only the scrolled viewport area.
const modalShot = (page, name) => expect(page).toHaveScreenshot(`${name}.png`);

test.describe("Visual snapshots", () => {
  test("M1: login page", async ({ open }) => {
    await shot(await open(null), "login");
  });

  test("M1: login page with an error", async ({ open }) => {
    const page = await open(null);
    await page.locator("#name").fill("someone");
    await page.locator("#password").fill("wrong");
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator("#msg")).not.toBeEmpty();
    await shot(page, "login-error");
  });

  test("M1: operator page", async ({ open }) => {
    await shot(await open("operator"), "operator");
  });

  test("M1: operator — credit category hint, combobox open", async ({ open }) => {
    const page = await open("operator");
    await page.locator("#bill-category-input").fill("Acme Credit");
    await page.locator("#bill-client-input").fill("a");
    await expect(page.locator("#bill-client-dropdown")).toBeVisible();
    await shot(page, "operator-combobox");
  });

  test("M1: operator — settle list with a selection", async ({ open }) => {
    const page = await open("operator");
    await new Combobox(page, "settle-company").pick("Acme Corp");
    await page.locator("#settle-bills-table .settle-bill-checkbox").first().check();
    await shot(page, "operator-settle");
  });

  test("M1: operator — refund modal", async ({ open }) => {
    const page = await open("operator");
    await page.locator(".refund-btn").first().click();
    await modalShot(page, "operator-refund-modal");
  });

  test("M1: change password modal with an error", async ({ open }) => {
    const page = await open("operator");
    await page.locator("#change-password-btn").click();
    await page.locator("#current-password").fill("x");
    await page.locator("#change-password-modal #new-password").fill("abc");
    await page.locator("#confirm-new-password").fill("abd");
    await page.locator('#change-password-form button[type="submit"]').click();
    await expect(page.locator("#change-password-msg")).not.toBeEmpty();
    await modalShot(page, "change-password-modal");
  });

  for (const tab of ["billing", "analytics", "promote", "reassign", "locations", "categories"]) {
    test(`M1: admin — ${tab} tab`, async ({ open }) => {
      const page = await open("admin");
      await page.locator(`.tabs button[data-tab="${tab}"]`).click();
      await page.waitForLoadState("networkidle");
      if (tab === "reassign") {
        await new Combobox(page, "reassign-bill").pick("0126100002", "0126100002 — Bharat Stores");
        await expect(page.locator("#reassign-history-table")).toBeVisible();
      }
      if (tab === "categories") await page.locator("#new-category-type").selectOption("credit");
      await shot(page, `admin-${tab}`);
    });
  }

  test("M1: developer page", async ({ open }) => {
    await shot(await open("developer"), "developer");
  });

  test("M1: accountant page with a client selected", async ({ open }) => {
    const page = await open("accountant");
    await new Combobox(page, "ledger-client").pick("Asha Traders");
    await expect(page.locator("#client-ledger-table tbody tr")).toHaveCount(2);
    await shot(page, "accountant");
  });
});
