// More flows through the administration and report screens and the shell:
// the add-user, location and lab-settings forms' validation, the day sheet
// on a past day, document verification, and navigation.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { uid } = require("../../helpers/data");
const { chooseOption } = require("../../helpers/ui");

const figure = (page, label) => page.getByRole("group", { name: label, exact: true });

test.describe("Forms that check what's typed", () => {
  test("add user: every field is required, the password policy is shown, and the confirmation must match", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/users");
    await lead.getByRole("button", { name: "Add user" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add user" });
    await dialog.getByRole("button", { name: "Add user" }).click();
    for (const text of ["Enter a login name", "Choose a role", "Enter a password", "Confirm the password"]) {
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await dialog.getByLabel("Login name").fill("   ");
    await dialog.getByLabel("Password", { exact: true }).fill("abc");
    for (const text of ["Enter a login name", "At least 6 characters", "At least one number", "At least one special character"]) {
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await dialog.getByLabel("Password", { exact: true }).fill("Strong@123");
    await dialog.getByLabel("Confirm password").fill("Strong@124");
    await expect(dialog.getByText("The passwords don't match")).toBeVisible();

    const name = uid("tech");
    await dialog.getByLabel("Login name").fill(`  ${name}  `);
    await chooseOption(lead, "Role", "Technician", dialog);
    await dialog.getByLabel("Confirm password").fill("Strong@123");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog).toBeHidden();
    await expect(lead.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    expect(await db().user.count({ where: { name } })).toBe(1); // stored trimmed
  });

  test("add location: a two-digit code, the address, a charge for home visits and a branch for a centre", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/locations");
    // Nothing invalid reaches the server (codes are shared by parallel tests,
    // so "nothing saved" is checked as "nothing sent").
    const saves = [];
    lead.on("request", (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/locations" && saves.push(r));
    await lead.getByRole("button", { name: "Add location" }).click();
    const dialog = lead.getByRole("dialog", { name: "Add location" });
    const codeError = dialog.getByText("Exactly two digits, e.g. 04");
    const codeField = dialog.getByLabel("Location code");
    for (const bad of ["7", "A1"]) {
      await codeField.fill("47");
      await expect(codeError).toBeHidden();
      await codeField.fill(bad);
      await expect(codeError).toBeVisible();
    }
    await codeField.fill("123"); // the field takes two characters at most
    await expect(codeField).toHaveValue("12");
    await expect(codeError).toBeHidden();
    await codeField.fill("47");
    await dialog.getByLabel("Offers home visits").click();
    await dialog.getByLabel("Collection centre").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    for (const text of ["Enter a name", "Enter the address", "Enter the charge", "Choose the processing branch"]) {
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(saves).toHaveLength(0);
  });

  test("lab settings: the name, phone and address are required and the email must be valid; nothing is saved", async ({ loginAs, users }) => {
    const lead = await loginAs(users.lead);
    await lead.goto("/settings");
    const before = await db().labSettings.findUnique({ where: { id: 1 } });
    await lead.getByLabel("Lab name").fill("");
    await lead.getByLabel("Email").fill("not-an-email");
    await lead.getByLabel("Phone").fill("");
    await lead.getByRole("button", { name: "Save" }).click();
    for (const text of ["Enter the lab's name", "Enter a valid email", "Enter a contact phone"]) {
      await expect(lead.getByText(text)).toBeVisible();
    }
    expect(await db().labSettings.findUnique({ where: { id: 1 } })).toEqual(before);
  });
});

test.describe("Day sheet", () => {
  test("a past day shows that day's money and bills; another day is empty; future days can't be picked", async ({ loginAs }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      const day = `2019-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
      const bill = await client.createBill({ items: ["CBC", "GLUF"], billDate: day, initialPayment: { amount: 250, mode: "credit_card" } });
      await db().transaction.updateMany({ where: { billId: bill.id }, data: { createdAt: new Date(`${day}T10:00:00+05:30`) } });

      const page = await loginAs(tech);
      await page.goto("/daysheet");
      await expect(figure(page, "Total to hand over")).toContainText("₹0.00"); // nothing today
      const [y, m, d] = day.split("-");
      const date = page.getByLabel("Date", { exact: true });
      await date.click();
      await date.fill(`${d}/${m}/${y}`);
      await date.press("Enter");
      await expect(figure(page, "Card")).toContainText("₹250.00");
      await expect(figure(page, "Total to hand over")).toContainText("₹250.00");
      await expect(figure(page, "Bills created")).toContainText("1");
      await expect(page.getByRole("row", { name: new RegExp(bill.billNumber) }).first()).toBeVisible();

      // The day after: nothing.
      const next = new Date(`${day}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const [ny, nm, nd] = next.toISOString().slice(0, 10).split("-");
      await date.click();
      await date.fill(`${nd}/${nm}/${ny}`);
      await date.press("Enter");
      await expect(figure(page, "Total to hand over")).toContainText("₹0.00");
      await expect(figure(page, "Bills created")).toContainText("0");

      // Tomorrow is disabled in the calendar.
      await date.click();
      const tomorrow = new Date(Date.now() + 24 * 3600e3);
      const tomorrowCell = page.locator(`.ant-picker-dropdown:visible td[title="${tomorrow.toISOString().slice(0, 10)}"]`);
      if (await tomorrowCell.count()) await expect(tomorrowCell).toHaveClass(/ant-picker-cell-disabled/);
    } finally {
      await client.dispose();
    }
  });
});

test.describe("Verify document", () => {
  test("a bill's code typed in lower case with spaces, a quote's code, and nonsense", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const quote = await techApi.createQuote({ items: ["CBC"] });
    const tech = await loginAs(users.tech1);
    await tech.goto("/verify");
    const code = tech.getByLabel("Verification code");

    await code.fill(`  ${bill.verificationCode.toLowerCase()} `);
    await code.press("Enter");
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Balance due");

    await code.fill(quote.verificationCode);
    await code.press("Enter");
    await expect(tech.getByRole("heading", { name: `Quotation ${quote.quoteNumber}` })).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Valid");
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toHaveCount(0);

    await code.fill("NOTAREALCODE");
    await code.press("Enter");
    await expect(tech.getByText("Not a document from this lab")).toBeVisible();
    await expect(tech.getByRole("heading", { name: `Quotation ${quote.quoteNumber}` })).toHaveCount(0);

    await code.fill("");
    await code.press("Enter");
    await expect(tech.getByText("Not a document from this lab")).toHaveCount(0);

    await code.fill(bill.verificationCode);
    await code.press("Enter");
    await tech.getByRole("link", { name: "Open" }).click();
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
  });
});

test.describe("Navigation", () => {
  test("Back and Forward move between a list and a record; an unknown address goes Home", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["GLUF"] });
    const tech = await loginAs(users.tech1);
    await tech.goto("/bills");
    await tech.getByLabel("Search bills").fill(bill.billNumber);
    await tech.getByLabel("Search bills").press("Enter");
    await tech.getByRole("link", { name: bill.billNumber, exact: true }).click();
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await tech.goBack();
    await expect(tech.getByRole("heading", { name: "Bills", exact: true })).toBeVisible();
    await tech.goForward();
    await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();

    await tech.goto("/no/such/page");
    await expect(tech).toHaveURL(/\/$/);
  });

  test("a record that doesn't exist says so instead of a blank page", async ({ loginAs, users }) => {
    const tech = await loginAs(users.tech1);
    const missing = "00000000-0000-0000-0000-000000000000";
    for (const path of [`/bills/${missing}`, `/quotations/${missing}`, `/patients/${missing}`, `/bills/new?quotation=${missing}`]) {
      await tech.goto(path);
      await expect(tech.getByRole("main").getByText(/not found|doesn't exist|no such|could not/i).first()).toBeVisible();
    }
  });

  test("an accountant's day sheet asks whose to open, and opens a technician's", async ({ loginAs, users }) => {
    const tech = await createUser("technician");
    const client = await ApiClient.as(tech);
    try {
      await client.createBill({ items: ["GLUF"], initialPayment: { amount: 100, mode: "cash" } });
      const acct = await loginAs(users.acct);
      await acct.goto("/daysheet");
      await expect(acct.getByText("Choose whose day sheet to open.")).toBeVisible();
      await chooseOption(acct, "Whose day sheet", `${tech.name} (Technician)`);
      await expect(figure(acct, "Cash")).toContainText("₹100.00");
    } finally {
      await client.dispose();
    }
  });
});
