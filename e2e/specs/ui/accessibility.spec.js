// axe-core scans (WCAG 2.1 A + AA) of every screen and its main dialogs.
const { test, expect } = require("../../fixtures");
const { accountMenu } = require("../../helpers/ui");
const AxeBuilder = require("@axe-core/playwright").default;

async function expectNoViolations(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
}

test.describe("Accessibility", () => {
  test("login", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await expectNoViolations(page);
  });

  test("home, as a technician", async ({ loginAs, users }) => {
    await expectNoViolations(await loginAs(users.tech1));
  });

  test("account menu, open", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    await page.getByRole("banner").getByRole("button", { name: /^Account: / }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).waitFor();
    await expectNoViolations(page);
  });

  test("change password dialog", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    await accountMenu(page, "Change password");
    await page.getByRole("dialog", { name: "Change password" }).waitFor();
    await expectNoViolations(page);
  });

  for (const [path, button] of [["/users", "Add user"], ["/locations", "Add location"], ["/settings", null]]) {
    test(`${path}, as the lead${button ? `, with "${button}" open` : ""}`, async ({ loginAs, users }) => {
      const page = await loginAs(users.lead);
      await page.goto(path);
      await page.getByRole("main").getByRole("table").or(page.getByRole("main").getByRole("button", { name: "Save" })).first().waitFor();
      await expectNoViolations(page);
      if (button) {
        await page.getByRole("button", { name: button }).click();
        await page.getByRole("dialog", { name: button }).waitFor();
        await expectNoViolations(page);
      }
    });
  }

  // Every Phase 1 screen, with data on it, and its main dialog.
  test.describe("Phase 1 screens", () => {
    let ids;
    test.beforeAll(async () => {
      const { ApiClient } = require("../../helpers/api");
      const { baseline } = require("../../helpers/db");
      const tech = await ApiClient.as({ name: "e2e-tech1", password: "Test@123" });
      try {
        const gtt = await baseline.item("GTT");
        const patient = await tech.registerPatient();
        const bill = await tech.createBill({
          patientId: patient.id,
          items: ["LIPID", "GTT"],
          discountAmount: 10,
          initialPayment: { amount: 100, mode: "cash" },
          pendingDraws: [{ catalogItemId: gtt.id, testId: gtt.id, sequence: 2, dueAt: new Date(Date.now() + 3600e3).toISOString() }],
        });
        const quote = await tech.createQuote({ items: ["LIPID"] });
        ids = { patient: patient.id, bill: bill.id, quote: quote.id };
      } finally {
        await tech.dispose();
      }
    });

    const SCREENS = [
      ["lead", "/patients", "Register patient"],
      ["lead", () => `/patients/${ids.patient}`, "Correct details"],
      ["lead", "/quotations", null],
      ["lead", "/quotations/new", null],
      ["lead", () => `/quotations/${ids.quote}`, null],
      ["lead", "/bills", null],
      ["lead", "/bills/new", null],
      ["lead", () => `/bills/${ids.bill}`, "Cancel tests"],
      ["lead", () => `/bills/${ids.bill}`, "Record payment"],
      ["lead", "/revisits", null],
      ["lead", "/daysheet", null],
      ["lead", "/settlement", null],
      ["lead", "/verify", null],
      ["lead", "/catalog", null],
      ["lead", "/catalog/entry", "Paste from Excel"],
      ["lead", "/doctors", "Add doctor"],
      ["lead", "/machines", "Add machine"],
      ["lead", "/approvals", null],
      ["tech1", "/requests", null],
      ["acct", "/analytics", null],
      ["lead", "/panels", "Add camp"],
      ["lead", () => `/print/bill/${ids.bill}`, null],
      ["lead", () => `/print/quotation/${ids.quote}`, null],
    ];
    for (const [who, path, button] of SCREENS) {
      const label = typeof path === "function" ? path.toString().replace(/^.*`(.*)`.*$/, "$1") : path;
      test(`${label} as ${who}${button ? `, with "${button}" open` : ""}`, async ({ loginAs, users }) => {
        const page = await loginAs(users[who]);
        await page.goto(typeof path === "function" ? path() : path);
        await page.waitForLoadState("networkidle");
        await expectNoViolations(page);
        if (button) {
          await page.getByRole("button", { name: button, exact: true }).click();
          await page.getByRole("dialog").waitFor();
          await expectNoViolations(page);
        }
      });
    }
  });

  test("the new-patient fields on New bill, and Register patient from the quick access bar", async ({ loginAs, users }) => {
    const page = await loginAs(users.tech1);
    await page.goto("/bills/new");
    await page.getByLabel("Full name").waitFor();
    await expectNoViolations(page);
    await page.getByRole("navigation", { name: "Quick access" }).getByRole("button", { name: "Register patient" }).click();
    await page.getByRole("dialog", { name: "Register patient" }).waitFor();
    await expectNoViolations(page);
  });

  test("home, as a pathologist, with the approval queue in the quick access bar and the menu collapsed", async ({ loginAs, users }) => {
    const page = await loginAs(users.path1);
    await page.getByRole("button", { name: "Collapse the menu" }).click();
    await page.waitForLoadState("networkidle");
    await expectNoViolations(page);
  });

  test("lab setup, as the developer", async ({ loginAs, users }) => {
    const page = await loginAs(users.dev);
    await page.goto("/setup");
    await page.getByText("Lead pathologist").first().waitFor();
    await expectNoViolations(page);
  });
});
