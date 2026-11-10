// The technician's daily report, as the lead cross-checks it: the day sheet
// is what one person took (payments, panel settlements, refunds taken off)
// and the bills they created. Each test owns its people, so every figure
// on their sheets is exact.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { istDate } = require("../../helpers/data");
const { chooseOption } = require("../../helpers/ui");
const { figure, section, dmy, fillPicker } = require("../../helpers/flows");

const money = (page) => section(page, "Money taken");
const bills = (page) => section(page, "Bills created");

// Throwaway reception users, each with an API session; disposed after the test.
const people = test.extend({
  staff: async ({}, use) => {
    const clients = [];
    await use(async (role = "technician") => {
      const user = await createUser(role);
      const client = await ApiClient.as(user);
      clients.push(client);
      return { user, api: client };
    });
    await Promise.all(clients.map((c) => c.dispose()));
  },
});

// Opens someone's day sheet as the lead or the accountant.
async function openSheetOf(page, user, role = "Technician") {
  await page.goto("/daysheet");
  await chooseOption(page, "Whose day sheet", `${user.name} (${role})`);
}

people.describe("One person's day", () => {
  people("cash, UPI and card payments, a refund taken off and a panel settlement add up to the hand-over figure", async ({ loginAs, staff, leadApi }) => {
    const { user, api } = await staff();
    const panel = await leadApi.addPanel();
    const a = await api.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    await api.cancel(a, ["GLUF"], { refundMode: "cash" }); // 100 back
    const b = await api.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "upi" } });
    const c = await api.createBill({ items: ["GLUF"] });
    await api.pay(c.id, 100, { mode: "credit_card" });
    const d = await api.createBill({ items: ["CBC"], payerType: "panel", panelId: panel.id });
    await api.call("POST", `/panels/${panel.id}/settle`, { billIds: [d.id], mode: "cash" });

    const page = await loginAs(user);
    await page.getByRole("menuitem", { name: "Day sheet" }).click();
    await expect(figure(page, "Cash")).toContainText("₹600.00"); // 400 − 100 + 300
    await expect(figure(page, "UPI")).toContainText("₹300.00");
    await expect(figure(page, "Card")).toContainText("₹100.00");
    await expect(figure(page, "Total to hand over")).toContainText("₹1,000.00");
    await expect(figure(page, "Bills created")).toContainText("4");

    const refund = money(page).getByRole("row", { name: /Refund/ });
    await expect(refund).toContainText(a.billNumber);
    await expect(refund).toContainText("-₹100.00");
    await expect(refund).toContainText("Cash");
    const settlement = money(page).getByRole("row", { name: /Panel settlement/ });
    await expect(settlement).toContainText(d.billNumber);
    await expect(settlement).toContainText("₹300.00");
    await expect(money(page).getByRole("row", { name: new RegExp(b.billNumber) })).toContainText("UPI");
    await expect(money(page).getByRole("row", { name: new RegExp(c.billNumber) })).toContainText("Card");
    // The table's own totals repeat the hand-over figure.
    await expect(money(page).getByRole("row", { name: /^Total to hand over/ })).toContainText("₹1,000.00");

    // Each bill, with what's been paid and what's left on it.
    const partly = bills(page).getByRole("row", { name: new RegExp(a.billNumber) });
    await expect(partly).toContainText("CBC");
    await expect(partly).not.toContainText("GLUF"); // the cancelled test is gone from it
    await expect(partly).toContainText("₹300.00");
    await expect(bills(page).getByRole("row", { name: new RegExp(d.billNumber) })).toContainText(panel.name);
  });

  people("money taken on a colleague's bill is on the taker's sheet; the bill stays on its creator's", async ({ loginAs, staff }) => {
    const [creator, taker] = [await staff(), await staff()];
    const bill = await creator.api.createBill({ items: ["CBC"] });
    await taker.api.pay(bill.id, 300, { mode: "upi" });

    const takerPage = await loginAs(taker.user);
    await takerPage.goto("/daysheet");
    await expect(figure(takerPage, "Total to hand over")).toContainText("₹300.00");
    await expect(figure(takerPage, "Bills created")).toContainText("0");
    await expect(money(takerPage).getByRole("row", { name: new RegExp(bill.billNumber) })).toContainText("₹300.00");
    await expect(bills(takerPage)).toContainText("No bills created");

    const creatorPage = await loginAs(creator.user);
    await creatorPage.goto("/daysheet");
    await expect(figure(creatorPage, "Total to hand over")).toContainText("₹0.00");
    await expect(money(creatorPage)).toContainText("No money taken");
    const row = bills(creatorPage).getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toContainText("Paid"); // paid, though not to them
    await expect(figure(creatorPage, "Bills created")).toContainText("1");
  });

  people("a refund given by someone else comes off the giver's sheet, not the one who took the payment", async ({ loginAs, staff }) => {
    const [taker, giver] = [await staff(), await staff()];
    const bill = await taker.api.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    await giver.api.cancel(bill, ["GLUF"], { refundMode: "cash" });

    const giverPage = await loginAs(giver.user);
    await giverPage.goto("/daysheet");
    await expect(figure(giverPage, "Cash")).toContainText("-₹100.00");
    await expect(figure(giverPage, "Total to hand over")).toContainText("-₹100.00");
    const takerPage = await loginAs(taker.user);
    await takerPage.goto("/daysheet");
    await expect(figure(takerPage, "Total to hand over")).toContainText("₹400.00");
  });

  people("a pathologist covering the front desk has a day sheet of their own", async ({ loginAs, staff }) => {
    const { user, api } = await staff("pathologist");
    const bill = await api.createBill({ items: ["GLUF"], initialPayment: { amount: 100, mode: "cash" } });
    const page = await loginAs(user);
    await page.getByRole("menuitem", { name: "Day sheet" }).click();
    await expect(page.getByLabel("Whose day sheet")).toHaveCount(0);
    await expect(figure(page, "Cash")).toContainText("₹100.00");
    await expect(bills(page).getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
  });

  people("bills on hold and cancelled bills are marked on the sheet", async ({ loginAs, staff }) => {
    const { user, api } = await staff();
    const held = await api.createBill({ items: ["CBC"], discountAmount: 50 });
    const gone = await api.createBill({ items: ["GLUF"], initialPayment: { amount: 100, mode: "cash" } });
    await api.cancel(gone, ["GLUF"], { refundMode: "cash" });

    const page = await loginAs(user);
    await page.goto("/daysheet");
    await expect(bills(page).getByRole("row", { name: new RegExp(held.billNumber) })).toContainText("Report on hold");
    await expect(bills(page).getByRole("row", { name: new RegExp(held.billNumber) })).toContainText("₹250.00");
    await expect(bills(page).getByRole("row", { name: new RegExp(gone.billNumber) })).toContainText("Cancelled");
    // Taken and given back the same day: nothing to hand over for it.
    await expect(figure(page, "Total to hand over")).toContainText("₹0.00");
    await expect(figure(page, "Bills created")).toContainText("2");
  });

  people("payments either side of midnight fall on their own days", async ({ loginAs, staff }) => {
    const { user, api } = await staff();
    const [day, next] = ["2021-03-14", "2021-03-15"];
    const bill = await api.createBill({ items: ["CBC"], billDate: day });
    const [late, early] = [await api.pay(bill.id, 120, { mode: "cash" }), await api.pay(bill.id, 180, { mode: "upi" })];
    await db().transaction.update({ where: { id: late.id }, data: { createdAt: new Date(`${day}T23:59:00+05:30`) } });
    await db().transaction.update({ where: { id: early.id }, data: { createdAt: new Date(`${next}T00:01:00+05:30`) } });

    const page = await loginAs(user);
    await page.goto("/daysheet");
    const date = page.getByLabel("Date", { exact: true });
    await fillPicker(date, dmy(day));
    await expect(figure(page, "Total to hand over")).toContainText("₹120.00");
    await expect(figure(page, "Cash")).toContainText("₹120.00");
    await expect(money(page).getByRole("row", { name: new RegExp(bill.billNumber) })).toContainText("11:59 PM");
    await expect(figure(page, "Bills created")).toContainText("1");

    await fillPicker(date, dmy(next));
    await expect(figure(page, "Total to hand over")).toContainText("₹180.00");
    await expect(figure(page, "UPI")).toContainText("₹180.00");
    await expect(money(page).getByRole("row", { name: new RegExp(bill.billNumber) })).toContainText("12:01 AM");
    await expect(figure(page, "Bills created")).toContainText("0");
  });
});

people.describe("The lead's cross-check", () => {
  people("a technician has no one else's sheet to pick, and a link to a colleague's is refused", async ({ loginAs, staff }) => {
    const [me, other] = [await staff(), await staff()];
    await other.api.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "cash" } });
    const page = await loginAs(me.user);
    await page.goto("/daysheet");
    await expect(page.getByLabel("Whose day sheet")).toHaveCount(0);
    await expect(page.getByText("What you took and billed on a day.")).toBeVisible();
    await page.goto(`/print/day-sheet?date=${istDate()}&userId=${other.user.id}`);
    await expect(page.getByText("You can only open your own day sheet.")).toBeVisible();
    await expect(page.getByText("₹300.00")).toHaveCount(0);
  });

  people("the lead opens a technician's sheet for the day and prints the same figures", async ({ loginAs, users, staff }) => {
    const { user, api } = await staff();
    const a = await api.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "cash" } });
    const b = await api.createBill({ items: ["GLUF"], initialPayment: { amount: 60, mode: "upi" } });

    const lead = await loginAs(users.lead);
    await lead.goto("/daysheet");
    await expect(lead.getByText("What one person took and billed on a day.")).toBeVisible();
    await chooseOption(lead, "Whose day sheet", `${user.name} (Technician)`);
    await expect(figure(lead, "Total to hand over")).toContainText("₹360.00");
    await expect(figure(lead, "Bills created")).toContainText("2");
    // From a row straight to the bill, to check it.
    await expect(bills(lead).getByRole("row", { name: new RegExp(b.billNumber) })).toContainText("₹40.00"); // its balance

    const [popup] = await Promise.all([lead.waitForEvent("popup"), lead.getByRole("button", { name: "Print", exact: true }).click()]);
    const sheet = popup.getByRole("main");
    for (const text of [user.name, dmy(istDate()), a.billNumber, b.billNumber, a.patient.name, "Total to hand over"]) await expect(sheet).toContainText(text);
    const totals = sheet.locator(".print-totals");
    await expect(totals.getByRole("row", { name: /^Cash/ })).toContainText("₹300.00");
    await expect(totals.getByRole("row", { name: /^UPI/ })).toContainText("₹60.00");
    await expect(totals.getByRole("row", { name: /^Card/ })).toContainText("₹0.00");
    await expect(totals.getByRole("row", { name: /^Total to hand over/ })).toContainText("₹360.00");
    await popup.close();

    await bills(lead).getByRole("link", { name: a.billNumber }).click();
    await expect(lead.getByRole("heading", { name: `Bill ${a.billNumber}` })).toBeVisible();
  });

  people("a reassigned bill moves to the new technician's sheet; the money stays with who took it", async ({ loginAs, users, staff, leadApi }) => {
    const [from, to] = [await staff(), await staff()];
    const bill = await from.api.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "cash" } });
    await leadApi.call("PATCH", `/bills/${bill.id}/reassign-technician`, { technicianId: to.user.id });

    const lead = await loginAs(users.lead);
    await openSheetOf(lead, from.user);
    await expect(figure(lead, "Total to hand over")).toContainText("₹300.00");
    await expect(figure(lead, "Bills created")).toContainText("0");
    await chooseOption(lead, "Whose day sheet", `${to.user.name} (Technician)`);
    await expect(figure(lead, "Total to hand over")).toContainText("₹0.00");
    await expect(figure(lead, "Bills created")).toContainText("1");
    await expect(bills(lead).getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
  });

  people("the sheet of someone who has since been deactivated can still be opened, and says so", async ({ loginAs, users, staff }) => {
    const { user, api } = await staff();
    const bill = await api.createBill({ items: ["CBC"], initialPayment: { amount: 300, mode: "cash" } });
    await db().user.update({ where: { id: user.id }, data: { isDeleted: true } });
    const lead = await loginAs(users.lead);
    await lead.goto("/daysheet");
    await chooseOption(lead, "Whose day sheet", `${user.name} (Technician, deactivated)`);
    await expect(figure(lead, "Total to hand over")).toContainText("₹300.00");
    await expect(bills(lead).getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
  });

  people("a day with nothing on it says so; Print waits until a sheet is open", async ({ loginAs, users, staff }) => {
    const { user } = await staff();
    const acct = await loginAs(users.acct);
    await acct.goto("/daysheet");
    await expect(acct.getByText("Choose whose day sheet to open.")).toBeVisible();
    await expect(acct.getByRole("button", { name: "Print", exact: true })).toBeDisabled();
    await chooseOption(acct, "Whose day sheet", `${user.name} (Technician)`);
    await expect(figure(acct, "Total to hand over")).toContainText("₹0.00");
    await expect(money(acct)).toContainText("No money taken");
    await expect(bills(acct)).toContainText("No bills created");
    await expect(acct.getByRole("button", { name: "Print", exact: true })).toBeEnabled();
  });
});
