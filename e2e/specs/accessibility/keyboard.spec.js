// M3: everything an operator does daily must work from the keyboard alone,
// with a logical tab order, visible focus, and properly behaved modals.
const { test, expect, knownBug } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { AdminPage } = require("../../pages/admin");
const { createUser, findBillByNumber, db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");

const activeId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);

// Presses Tab until the element with `id` has focus (max `limit` presses).
async function tabTo(page, id, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if ((await activeId(page)) === id) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`#${id} was not reachable with Tab within ${limit} presses`);
}

// Sequence of distinct focused ids while tabbing `count` times from the current
// element. Tabs at a human pace: combobox lists linger ~150ms after blur
// (BUG-009) and, being scrollable, are themselves a Tab stop while visible.
async function tabSequence(page, count) {
  const seen = [await activeId(page)];
  while (seen.length < count) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(200);
    const id = await activeId(page);
    if (id !== seen[seen.length - 1]) seen.push(id); // date inputs take several Tabs (d/m/y)
  }
  return seen;
}

test.describe("Keyboard-only workflows", () => {
  test("M3a: log in with the keyboard only", async ({ page, users }) => {
    await page.goto("/login.html");
    await tabTo(page, "name");
    await page.keyboard.type(users.op1.name);
    await page.keyboard.press("Tab");
    await page.keyboard.type(users.op1.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/operator\.html$/);
  });

  test("M3b: Create Bill tab order follows the visual order (with a realistic client list)", async ({ loginAs, users }) => {
    knownBug("BUG-018");
    // A real shop has many clients: enough that the suggestion list scrolls.
    await db().client.createMany({ data: Array.from({ length: 25 }, () => ({ name: uid("TabOrder") })) });
    const page = await loginAs(users.op1);
    await page.locator("#bill-client-input").focus();
    // "" in the sequence would mean focus fell to <body> (BUG-018).
    expect(await tabSequence(page, 8)).toEqual([
      "bill-client-input", "bill-category-input", "bill-date", "bill-location-input",
      "original-amount", "discount-amount", "initial-amount", "initial-mode",
    ]);
    await page.keyboard.press("Tab");
    await expect(page.locator('#bill-form button[type="submit"]')).toBeFocused();
  });

  test("M3c: create a bill and collect payment using only the keyboard", async ({ page, users }) => {
    const user = await createUser("operator");
    await page.goto("/login.html");
    await tabTo(page, "name");
    await page.keyboard.type(user.name);
    await page.keyboard.press("Tab");
    await page.keyboard.type(user.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/operator\.html$/);
    await page.waitForLoadState("networkidle");

    const client = uid("Kbd");
    await tabTo(page, "bill-client-input");
    await page.keyboard.type(client); // new client — no suggestion to commit
    await page.keyboard.press("Tab");
    await page.keyboard.type(BASELINE.standardCategory.name.slice(0, 8)); // narrows to one match
    await page.keyboard.press("Tab"); // commits the single match and moves on
    await tabTo(page, "bill-location-input");
    await page.keyboard.type(BASELINE.location.name.slice(0, 8));
    await page.keyboard.press("Tab");
    await page.keyboard.type("750");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("250");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown"); // cash -> credit_card
    await page.keyboard.press("Tab"); // Enter on a <select> doesn't submit; go to the button
    await page.keyboard.press("Enter");

    const ui = new BillingPage(page);
    await expect(ui.billMsg).toHaveClass(/success/);
    const bill = await findBillByNumber(BillingPage.billNumberFrom(await ui.billMsg.textContent()));
    expect(Number(bill.originalAmount)).toBe(750);
    expect(Number(bill.balance)).toBe(500);
    expect(bill.transactions[0].mode).toBe("credit_card");

    // Record Payment for the rest, keyboard only.
    await tabTo(page, "tx-bill-input");
    await page.keyboard.type(bill.billNumber);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(ui.txBill.hidden).toHaveValue(bill.id);
    await page.keyboard.press("Tab");
    await page.keyboard.type("500");
    await page.keyboard.press("Enter");
    await expect(ui.txMsg).toHaveText("Payment recorded.");
    expect((await findBillByNumber(bill.billNumber)).status).toBe("fully_paid");
  });

  test("M3d: settle bills with Tab + Space on the checkboxes", async ({ loginAs, adminApi }) => {
    const { company, category } = await adminApi.addCreditCategory();
    const bills = [];
    for (const amt of [100, 200]) bills.push(await adminApi.createBill({ categoryId: category.id, originalAmount: amt }));
    const ui = new BillingPage(await loginAs(await createUser("operator")));
    const page = ui.page;

    await tabTo(page, "settle-company-input");
    await page.keyboard.type(company.name);
    await page.keyboard.press("Enter");
    await expect(ui.settleTable.locator(".settle-bill-checkbox")).toHaveCount(2);
    await page.keyboard.press("Tab"); // mode select
    await page.keyboard.press("Tab"); // first checkbox
    await page.keyboard.press("Space");
    await expect(ui.settleTotal).toContainText("(1 bill)");
    await tabTo(page, "settle-submit-btn");
    await page.keyboard.press("Enter");
    await expect(ui.settleMsg).not.toBeEmpty();
    expect(await ui.settleMsg.textContent()).toMatch(/^Settled /);
    const statuses = await Promise.all(bills.map(async (b) => (await db().bill.findUnique({ where: { id: b.id } })).status));
    expect(statuses.sort()).toEqual(["fully_paid", "pending"]);
  });

  test("M3e: admin tabs can be switched with the keyboard", async ({ loginAs, users }) => {
    const admin = new AdminPage(await loginAs(users.admin));
    await admin.tabButton("billing").focus();
    for (const tab of ["analytics", "promote", "reassign", "locations", "categories"]) {
      await admin.page.keyboard.press("Tab");
      await expect(admin.tabButton(tab)).toBeFocused();
      await admin.page.keyboard.press("Enter");
      await expect(admin.page.locator(`#tab-${tab}`)).toBeVisible();
    }
  });

  test("M3f: every button shows a visible focus outline", async ({ loginAs, users }) => {
    const page = await loginAs(users.admin);
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent)
        .filter((b) => {
          b.focus();
          const s = getComputedStyle(b);
          const ok = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
          b.blur();
          return !ok;
        })
        .map((b) => b.id || b.dataset.tab || b.textContent.trim())
    );
    expect(missing).toEqual([]);
  });

  test("M3g: inputs and selects show the explicit 2px keyboard focus ring", async ({ loginAs, users }) => {
    knownBug("BUG-016");
    const p = await loginAs(users.op1);
    await p.locator("#bill-client-input").focus();
    const weak = [];
    for (const id of ["bill-client-input", "bill-category-input", "bill-date", "bill-location-input", "original-amount", "initial-mode"]) {
      await tabTo(p, id);
      const s = await p.locator(`#${id}`).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      if (s.style === "none" || s.width < 2) weak.push(id);
    }
    expect(weak).toEqual([]);
  });
});

test.describe("Modal dialogs (BUG-015)", () => {
  for (const which of ["change-password", "refund"]) {
    test(`M3h: ${which} modal — focus moves in, is trapped, Escape closes, focus returns`, async ({ loginAs, api }) => {
      knownBug("BUG-015");
      const user = await createUser("operator");
      await (await api(user)).createBill({ initialAmountCollected: 10 });
      const page = await loginAs(user);
      const opener = which === "refund" ? page.locator(".refund-btn").first() : page.locator("#change-password-btn");
      const modal = page.locator(`#${which}-modal`);

      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(modal).toBeVisible();

      expect(await modal.locator("[role=dialog], .modal-box").first().evaluate((el) =>
        el.getAttribute("role") === "dialog" || el.closest("[role=dialog]") !== null
      )).toBe(true);
      expect(await page.evaluate((id) => document.getElementById(id).contains(document.activeElement), `${which}-modal`)).toBe(true);

      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate((id) => document.getElementById(id).contains(document.activeElement), `${which}-modal`)).toBe(true);
      }

      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
      await expect(opener).toBeFocused();
    });
  }
});
