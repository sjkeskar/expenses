// M2: automated accessibility scans (axe-core, WCAG 2.1 A/AA + best
// practices) of every page and the interactive states that render extra UI.
//
// Each state gets a full scan ("no violations"): every rule except those tied
// to a still-open bug (OPEN_BUG_RULES — none at the moment), so any new problem
// fails immediately.
//
// The rules behind the a11y bugs fixed so far (BUG_RULES) are also scanned on
// their own, against the exact states that used to fail, as named regression
// tests — so a reintroduced bug fails under its own ID, not as an anonymous
// scan failure. When a new a11y bug is filed: add its rules to BUG_RULES and
// OPEN_BUG_RULES, and add a knownBug test below.
const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { AdminPage } = require("../../pages/admin");
const { AnalyticsSection } = require("../../pages/analytics");
const { LoginPage } = require("../../pages/login");
const { createUser } = require("../../helpers/db");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

// axe rules behind each accessibility bug (all closed — see bugs/Closed/).
const BUG_RULES = {
  "BUG-012": ["color-contrast"],
  "BUG-013": ["label", "empty-table-header"],
  "BUG-014": ["aria-required-attr", "aria-required-parent"],
  "BUG-017": ["landmark-one-main", "region"],
};
// Rules excluded from the full scan because their bug is still open.
const OPEN_BUG_RULES = [];

function describeViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function scanExcludingOpenBugs(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(OPEN_BUG_RULES).analyze();
  return describeViolations(violations);
}

async function scanOnly(page, rules) {
  const { violations } = await new AxeBuilder({ page }).withRules(rules).analyze();
  return describeViolations(violations);
}

// Builds a page state for scanning. Returns the Page.
const STATES = {
  "login page with an error message": async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login("nobody", "Wrong@123");
    await expect(login.msg).not.toBeEmpty();
    return page;
  },

  "operator page with bills in every status, settle list and an open dropdown": async ({ loginAs, api, adminApi }) => {
    const user = await createUser("operator");
    const op = await api(user);
    const { category, company } = await adminApi.addCreditCategory();
    await op.createBill({ categoryId: category.id });
    await op.createBill({ initialAmountCollected: 1000 });
    const refunded = await op.createBill({ initialAmountCollected: 5 });
    await op.refund(refunded.id);
    const ui = new BillingPage(await loginAs(user));
    await ui.selectSettleCompany(company.name);
    await ui.category.input.fill("E2E");
    await expect(ui.category.dropdown).toBeVisible();
    return ui.page;
  },

  "operator refund modal": async ({ loginAs, api }) => {
    const user = await createUser("operator");
    await (await api(user)).createBill({ initialAmountCollected: 10 });
    const ui = new BillingPage(await loginAs(user));
    await ui.page.locator(".refund-btn").first().click();
    await expect(ui.refundModal.modal).toBeVisible();
    return ui.page;
  },

  "change password modal": async ({ loginAs, users }) => {
    const page = await loginAs(users.acct);
    await page.locator("#change-password-btn").click();
    await expect(page.locator("#change-password-modal")).toBeVisible();
    return page;
  },

  "developer page with every role badge": async ({ loginAs, users }) => {
    for (const role of ["operator", "admin", "developer", "accountant"]) await createUser(role);
    const page = await loginAs(users.dev);
    await page.locator("#create-msg").waitFor({ state: "attached" });
    return page;
  },

  "accountant page with all-time data and a client selected": async ({ loginAs, users, adminApi }) => {
    const bill = await adminApi.createBill({ initialAmountCollected: 100 });
    const a = new AnalyticsSection(await loginAs(users.acct));
    await a.clearRange();
    await a.selectLedgerClient(bill.client.name);
    return a.page;
  },
};

for (const tab of ["billing", "analytics", "promote", "reassign", "locations", "categories"]) {
  STATES[`admin ${tab} tab`] = async ({ loginAs, users, adminApi }) => {
    await adminApi.createBill({ initialAmountCollected: 1000 });
    const admin = new AdminPage(await loginAs(users.admin));
    await admin.openTab(tab);
    if (tab === "categories") await admin.categories.type.selectOption("credit");
    return admin.page;
  };
}

test.describe("Accessibility scan — no violations", () => {
  for (const [name, build] of Object.entries(STATES)) {
    test(`M2: ${name}`, async ({ page, loginAs, api, adminApi, users }) => {
      const fixtures = { page, loginAs, api, adminApi, users };
      const built = await build(fixtures);
      expect(await scanExcludingOpenBugs(built)).toEqual([]);
    });
  }
});

test.describe("Accessibility — regression tests for fixed bugs", () => {
  test("M2/BUG-012: status and role badges meet WCAG AA colour contrast", async ({ page, loginAs, api, adminApi, users }) => {
    const fixtures = { page, loginAs, api, adminApi, users };
    const violations = [
      ...(await scanOnly(await STATES["operator page with bills in every status, settle list and an open dropdown"](fixtures), BUG_RULES["BUG-012"])),
      ...(await scanOnly(await STATES["developer page with every role badge"](fixtures), BUG_RULES["BUG-012"])),
    ];
    expect(violations).toEqual([]);
  });

  test("M2/BUG-013: settle-list checkboxes and table headers have accessible names", async ({ page, loginAs, api, adminApi, users }) => {
    const fixtures = { page, loginAs, api, adminApi, users };
    const built = await STATES["operator page with bills in every status, settle list and an open dropdown"](fixtures);
    expect(await scanOnly(built, BUG_RULES["BUG-013"])).toEqual([]);
  });

  test("M2/BUG-014: an open combobox exposes valid listbox/option ARIA", async ({ page, loginAs, api, adminApi, users }) => {
    const fixtures = { page, loginAs, api, adminApi, users };
    const built = await STATES["operator page with bills in every status, settle list and an open dropdown"](fixtures);
    expect(await scanOnly(built, BUG_RULES["BUG-014"])).toEqual([]);
  });

  test("M2/BUG-017: the login page has a main landmark containing its content", async ({ page, loginAs, api, adminApi, users }) => {
    const fixtures = { page, loginAs, api, adminApi, users };
    const built = await STATES["login page with an error message"](fixtures);
    expect(await scanOnly(built, BUG_RULES["BUG-017"])).toEqual([]);
  });
});
