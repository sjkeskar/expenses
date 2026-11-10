// The accountant's cross-check, through the screens: the tally for a period
// against known payments, settlements and refunds; the same money on the
// day sheets; each summary and its PDF; and what an accountant can't do.
// Each money test owns a far-off day and pins its movements to it, so the
// figures on screen are exactly its own.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption } = require("../../helpers/ui");
const { figure, section, dmy, fillPicker } = require("../../helpers/flows");

// A far-off IST day for one test to own. Random, so repeated runs against
// the same database (--repeat-each) don't share a day either.
const crypto = require("crypto");
const two = (n) => String(n).padStart(2, "0");
const ownDay = () => `${crypto.randomInt(2001, 2019)}-${two(crypto.randomInt(1, 13))}-${two(crypto.randomInt(1, 29))}`;

// Moves everything recorded on these bills after their creation to `day` (IST).
async function pinToDay(billIds, day) {
  const at = new Date(`${day}T15:00:00+05:30`);
  await db().transaction.updateMany({ where: { billId: { in: billIds }, createdAt: { gte: new Date(Date.now() - 3600e3) } }, data: { createdAt: at } });
  await db().refund.updateMany({ where: { billId: { in: billIds } }, data: { createdAt: at } });
}

// One technician's day on `day`: two self-pay bills (one partly cancelled
// and refunded, one discounted), a panel bill settled, a panel bill unpaid.
//   payments: cash 400, card 250 · settlement: cash 300 · refund: UPI 100
//   net collected 850 · billed 1,200 on 4 bills · discount 50 (pending)
async function aDay(day, leadApi) {
  const user = await createUser("technician");
  const api = await ApiClient.as(user);
  const [settled, owing] = [await leadApi.addPanel({ type: "insurer" }), await leadApi.addPanel()];
  const a = await api.createBill({ items: ["CBC", "GLUF"], billDate: day, initialPayment: { amount: 400, mode: "cash" } });
  await api.cancel(a, ["GLUF"], { refundMode: "upi" });
  const b = await api.createBill({ items: ["CBC"], billDate: day, discountAmount: 50, initialPayment: { amount: 250, mode: "credit_card" } });
  const c = await api.createBill({ items: ["CBC"], billDate: day, payerType: "panel", panelId: settled.id });
  await api.call("POST", `/panels/${settled.id}/settle`, { billIds: [c.id], mode: "cash" });
  const d = await api.createBill({ items: ["CBC"], billDate: day, payerType: "panel", panelId: owing.id });
  await pinToDay([a.id, b.id, c.id, d.id], day);
  await api.dispose();
  return { user, bills: { a, b, c, d }, panels: { settled, owing } };
}

// Sets the analytics period to one custom day.
async function choosePeriod(page, from, to = from) {
  await page.getByText("Custom", { exact: true }).click();
  await page.getByPlaceholder("Start date").click();
  await page.getByPlaceholder("Start date").fill(dmy(from));
  await page.getByPlaceholder("Start date").press("Enter");
  await page.getByPlaceholder("End date").fill(dmy(to));
  await page.getByPlaceholder("End date").press("Enter");
  await expect(page.getByText(from === to ? `Period: ${dmy(from)}` : `Period: ${dmy(from)} – ${dmy(to)}`)).toBeVisible();
}

const modeRow = (page, mode) => section(page, "By payment mode").getByRole("row", { name: new RegExp(`^${mode}`) });

test.describe("The tally", () => {
  test("payments, settlements and refunds for a day, by mode, match what was actually recorded", async ({ loginAs, users, leadApi }) => {
    const day = ownDay();
    const { panels } = await aDay(day, leadApi);
    const acct = await loginAs(users.acct);
    await acct.getByRole("menuitem", { name: "Analytics" }).click();
    await choosePeriod(acct, day);

    await expect(figure(acct, "Payments")).toContainText("₹650.00");
    await expect(figure(acct, "Panel settlements")).toContainText("₹300.00");
    await expect(figure(acct, "Refunds")).toContainText("₹100.00");
    await expect(figure(acct, "Net collected")).toContainText("₹850.00");

    // Cash: 400 paid + 300 settled. Card: 250 paid. UPI: only the 100 refund.
    for (const text of ["₹400.00", "₹300.00", "₹700.00"]) await expect(modeRow(acct, "Cash")).toContainText(text);
    await expect(modeRow(acct, "Card")).toContainText("₹250.00");
    await expect(modeRow(acct, "UPI")).toContainText("₹100.00");
    await expect(modeRow(acct, "UPI")).toContainText("-₹100.00");
    for (const text of ["₹650.00", "₹300.00", "₹100.00", "₹850.00"]) await expect(modeRow(acct, "Total")).toContainText(text);

    // The discount given that day is still waiting for a pathologist.
    const discounts = section(acct, "Discounts on the period's bills");
    await expect(discounts.getByRole("row", { name: /^Awaiting approval/ })).toContainText("₹50.00");
    await expect(discounts.getByRole("row", { name: /^Awaiting approval/ })).toContainText("1");
    await expect(discounts.getByRole("row", { name: /^Approved/ })).toContainText("₹0.00");

    // What panels owe is as of now: the unpaid panel bill, not the settled one.
    const owed = section(acct, "Panel balances outstanding now");
    await expect(owed.getByRole("row", { name: new RegExp(panels.owing.name) })).toContainText("₹300.00");
    await expect(owed.getByRole("row", { name: new RegExp(panels.settled.name) })).toHaveCount(0);
  });

  test("the tally for a day equals that day's day sheets, checked on screen", async ({ loginAs, users, leadApi }) => {
    const day = ownDay();
    const { user, bills } = await aDay(day, leadApi);
    const acct = await loginAs(users.acct);
    await acct.goto("/analytics");
    await choosePeriod(acct, day);
    await expect(figure(acct, "Net collected")).toContainText("₹850.00");
    await expect(acct.getByText("These totals equal the sum of every day sheet in the period.")).toBeVisible();

    // Only this technician took money that day, so their sheet is the whole tally.
    await acct.getByRole("menuitem", { name: "Day sheet" }).click();
    await chooseOption(acct, "Whose day sheet", `${user.name} (Technician)`);
    await fillPicker(acct.getByLabel("Date", { exact: true }), dmy(day));
    await expect(figure(acct, "Total to hand over")).toContainText("₹850.00");
    await expect(figure(acct, "Cash")).toContainText("₹700.00");
    await expect(figure(acct, "Card")).toContainText("₹250.00");
    await expect(figure(acct, "UPI")).toContainText("-₹100.00");
    await expect(figure(acct, "Bills created")).toContainText("4");

    // From a line of the sheet to the bill behind it: readable, not changeable.
    await section(acct, "Money taken").getByRole("row", { name: /Refund/ }).getByRole("link", { name: bills.a.billNumber }).click();
    await expect(acct.getByRole("heading", { name: `Bill ${bills.a.billNumber}` })).toBeVisible();
    await expect(section(acct, "Payments and refunds").getByRole("row", { name: /Refund/ })).toContainText("-₹100.00");
    for (const name of ["Record payment", "Cancel tests", "Change discount", "Reassign"]) await expect(acct.getByRole("button", { name })).toHaveCount(0);
  });

  test("a period with no activity says so on the tally and on every summary", async ({ loginAs, users }) => {
    const acct = await loginAs(users.acct);
    await acct.goto("/analytics");
    await choosePeriod(acct, "1995-01-05", "1995-01-07");
    await expect(figure(acct, "Net collected")).toContainText("₹0.00");
    await expect(section(acct, "By payment mode")).toContainText("₹0.00"); // only the Total row
    await expect(modeRow(acct, "Cash")).toHaveCount(0);
    for (const tab of ["Day-wise", "Staff-wise", "Location-wise", "Referral-wise", "Payer-wise", "Test-wise"]) {
      await acct.getByRole("tab", { name: tab }).click();
      await expect(section(acct, tab)).toContainText("Nothing in this period");
    }
  });

  test("a period can't run into the future: tomorrow isn't accepted as its end", async ({ loginAs, users }) => {
    const acct = await loginAs(users.acct);
    await acct.goto("/analytics");
    await acct.getByText("Custom", { exact: true }).click();
    const period = acct.getByText(/^Period: /);
    const before = await period.textContent();
    const tomorrow = new Date(Date.now() + 2 * 86400e3);
    const text = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).format(tomorrow);
    await acct.getByPlaceholder("End date").click();
    await acct.getByPlaceholder("End date").fill(text);
    await acct.getByPlaceholder("End date").press("Enter");
    await acct.keyboard.press("Escape");
    await expect(period).toHaveText(before);
    await expect(period).not.toContainText(text);
  });
});

test.describe("The summaries", () => {
  test("each summary shows the day's own rows, and downloads as its own PDF", async ({ loginAs, users, leadApi }) => {
    const day = ownDay();
    const { user, panels } = await aDay(day, leadApi);
    const acct = await loginAs(users.acct);
    await acct.goto("/analytics");
    await choosePeriod(acct, day);
    const open = async (tab) => {
      await acct.getByRole("tab", { name: tab }).click();
      return section(acct, tab);
    };
    const pdf = async (name) => {
      const download = acct.waitForEvent("download");
      await acct.getByRole("button", { name: "Download PDF" }).click();
      expect((await download).suggestedFilename()).toBe(name);
    };

    // Day-wise: 3 payments in (two payments and a settlement), 1 refund out.
    let row = (await open("Day-wise")).getByRole("row", { name: new RegExp(`^${dmy(day)}`) });
    for (const text of ["₹700.00", "₹250.00", "-₹100.00", "₹850.00"]) await expect(row).toContainText(text);
    await expect(row.getByRole("cell").nth(1)).toHaveText("3");
    await expect(row.getByRole("cell").nth(2)).toHaveText("1");
    await pdf("day-wise.pdf");

    // Staff-wise: the one technician, 4 bills worth 1,200, 50 off, 300 still owed (the unpaid panel bill).
    row = (await open("Staff-wise")).getByRole("row", { name: new RegExp(`^${user.name}`) });
    for (const text of ["₹1,200.00", "₹50.00", "₹300.00", "₹850.00"]) await expect(row).toContainText(text);
    await expect(row.getByRole("cell").nth(1)).toHaveText("4");
    await pdf("technician-wise.pdf");

    row = (await open("Location-wise")).getByRole("row", { name: new RegExp(`^${BASELINE.branch.name}`) });
    await expect(row).toContainText("Branch");
    await expect(row).toContainText("₹1,200.00");
    await pdf("location-wise.pdf");

    row = (await open("Referral-wise")).getByRole("row", { name: /^Walk-in/ });
    for (const text of ["₹1,200.00", "₹50.00", "₹1,150.00", "₹300.00"]) await expect(row).toContainText(text);
    await pdf("referral-wise.pdf");

    const payers = await open("Payer-wise");
    await expect(payers.getByRole("row", { name: /^Self/ })).toContainText("₹550.00"); // 300 + 300 − 50
    await expect(payers.getByRole("row", { name: new RegExp(`^${panels.settled.name} \\(Insurer\\)`) })).toContainText("₹300.00");
    await expect(payers.getByRole("row", { name: new RegExp(`^${panels.owing.name} \\(Corporate\\)`) })).toContainText("₹300.00");
    await pdf("payer-wise.pdf");

    // Test-wise: CBC billed on all four; GLUF only cancelled.
    const tests = await open("Test-wise");
    const cbc = tests.getByRole("row", { name: /^CBC/ });
    await expect(cbc).toContainText("₹1,200.00");
    await expect(cbc.getByRole("cell").nth(3)).toHaveText("4");
    const gluf = tests.getByRole("row", { name: /^GLUF/ });
    await expect(gluf).toContainText("₹0.00");
    await expect(gluf.getByRole("cell").nth(3)).toHaveText("0");
    await expect(gluf.getByRole("cell").nth(5)).toHaveText("1");
    await pdf("test-wise.pdf");

    await acct.getByRole("tab", { name: "Patient balances" }).click();
    await expect(section(acct, "Patient balances").getByRole("columnheader", { name: "Outstanding" })).toBeVisible();
    await pdf("patient-outstanding.pdf");
    await acct.getByRole("tab", { name: "Tally" }).click();
    await pdf("tally.pdf");
  });

  test("a bill cancelled outright drops out of the bill counts, but its refund still shows in the money", async ({ loginAs, users }) => {
    const day = ownDay();
    const user = await createUser("technician");
    const api = await ApiClient.as(user);
    const bill = await api.createBill({ items: ["CBC"], billDate: day, initialPayment: { amount: 300, mode: "cash" } });
    await api.cancel(bill, ["CBC"], { refundMode: "cash" });
    await pinToDay([bill.id], day);
    await api.dispose();

    const acct = await loginAs(users.acct);
    await acct.goto("/analytics");
    await choosePeriod(acct, day);
    await expect(figure(acct, "Payments")).toContainText("₹300.00");
    await expect(figure(acct, "Refunds")).toContainText("₹300.00");
    await expect(figure(acct, "Net collected")).toContainText("₹0.00");
    await acct.getByRole("tab", { name: "Location-wise" }).click();
    await expect(section(acct, "Location-wise")).toContainText("Nothing in this period");
    await acct.getByRole("tab", { name: "Test-wise" }).click();
    const cbc = section(acct, "Test-wise").getByRole("row", { name: /^CBC/ });
    await expect(cbc.getByRole("cell").nth(3)).toHaveText("0");
    await expect(cbc.getByRole("cell").nth(5)).toHaveText("1");
  });

  test("the lead sees the same analytics as the accountant", async ({ loginAs, users, leadApi }) => {
    const day = ownDay();
    await aDay(day, leadApi);
    const lead = await loginAs(users.lead);
    await lead.getByRole("menuitem", { name: "Analytics" }).click();
    await choosePeriod(lead, day);
    await expect(figure(lead, "Net collected")).toContainText("₹850.00");
  });
});

test.describe("Reading, not acting", () => {
  test("the accountant has no front-desk shortcuts: no quick access buttons, and Alt+B goes nowhere", async ({ loginAs, users }) => {
    const acct = await loginAs(users.acct);
    await expect(acct.getByRole("navigation", { name: "Quick access" }).getByRole("button")).toHaveCount(0);
    await acct.goto("/bills");
    await expect(acct.getByRole("heading", { name: "Bills" })).toBeVisible();
    await expect(acct.getByRole("button", { name: "New bill" })).toHaveCount(0);
    await acct.keyboard.press("Alt+B");
    await acct.keyboard.press("Alt+Q");
    await acct.keyboard.press("Alt+P");
    await expect(acct.getByRole("heading", { name: "Bills" })).toBeVisible();
    await expect(acct.getByRole("dialog")).toHaveCount(0);
  });

  test("addresses of the screens that change things send the accountant Home", async ({ loginAs, users }) => {
    const acct = await loginAs(users.acct);
    for (const path of ["/bills/new", "/quotations/new", "/approvals", "/requests", "/patients", "/revisits", "/settlement", "/catalog/entry", "/panels", "/users", "/machines"]) {
      await acct.goto(path);
      await expect(acct.getByRole("heading", { name: `Welcome, ${users.acct.name}` }), path).toBeVisible();
    }
  });

  test("the accountant finds a bill by its number and by status, and prints it", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "upi" } });
    const acct = await loginAs(users.acct);
    await acct.goto("/bills");
    await acct.getByLabel("Search bills").fill(bill.billNumber);
    await acct.getByLabel("Search bills").press("Enter");
    const row = acct.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toContainText("Paid");
    await acct.locator(".ant-segmented").getByText("Balance due", { exact: true }).click();
    await expect(row).toHaveCount(0);
    await acct.locator(".ant-segmented").getByText("Paid", { exact: true }).click();
    await row.getByRole("link", { name: bill.billNumber }).click();
    const [popup] = await Promise.all([acct.waitForEvent("popup"), acct.getByRole("button", { name: "Print bill" }).click()]);
    await expect(popup.getByRole("main", { name: `Bill ${bill.billNumber}` })).toContainText("Paid (UPI)");
  });

  test("the accountant verifies a bill's code against the lab's record", async ({ loginAs, users, techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"] });
    const acct = await loginAs(users.acct);
    await acct.getByRole("menuitem", { name: "Verify document" }).click();
    await acct.getByLabel("Verification code").fill(bill.verificationCode);
    await acct.getByLabel("Verification code").press("Enter");
    await expect(acct.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    await expect(acct.getByRole("main")).toContainText(bill.patient.name);
  });
});
