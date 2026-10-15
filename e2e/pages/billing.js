// Billing UI shared by operator.html and admin.html's Billing tab (identical
// element ids on both): Create Bill, Record Payment, Settle Company Balance,
// My Bills + Refund.
const { expect } = require("@playwright/test");
const { Combobox, ChangePasswordModal, RefundModal, rowByFirstCell, tableRows, clearMsg } = require("./components");

class BillingPage {
  constructor(page) {
    this.page = page;
    this.header = {
      userName: page.locator("#user-name"),
      logout: page.locator("#logout-btn"),
      reminder: page.locator("#reminder"),
    };
    this.changePassword = new ChangePasswordModal(page);

    // Create Bill
    this.client = new Combobox(page, "bill-client");
    this.category = new Combobox(page, "bill-category");
    this.location = new Combobox(page, "bill-location");
    this.categoryInfo = page.locator("#bill-category-info");
    this.billDate = page.locator("#bill-date");
    this.originalAmount = page.locator("#original-amount");
    this.discountAmount = page.locator("#discount-amount");
    this.initialAmount = page.locator("#initial-amount");
    this.initialMode = page.locator("#initial-mode");
    this.createBillButton = page.locator('#bill-form button[type="submit"]');
    this.billMsg = page.locator("#bill-msg");

    // Record Payment
    this.txBill = new Combobox(page, "tx-bill");
    this.txAmount = page.locator("#tx-amount");
    this.txDiscount = page.locator("#tx-discount");
    this.txMode = page.locator("#tx-mode");
    this.txSubmit = page.locator('#transaction-form button[type="submit"]');
    this.txMsg = page.locator("#tx-msg");

    // Settle Company Balance
    this.settleCompany = new Combobox(page, "settle-company");
    this.settleMode = page.locator("#settle-mode");
    this.settleTable = page.locator("#settle-bills-table");
    this.settleTotal = page.locator("#settle-total-info");
    this.settleSubmit = page.locator("#settle-submit-btn");
    this.settleMsg = page.locator("#settle-msg");

    // My Bills
    this.billsTable = page.locator("#bills-table");
    this.myBillsSummary = page.locator("#my-bills-summary");
    this.myBillsPdf = page.locator("#download-my-bills-pdf");
    this.refundModal = new RefundModal(page);
  }

  // Fills the Create Bill form. Only `client`, `original` and the pickers are
  // required; `newClient: true` types the client name instead of picking it.
  async fillBill({
    client,
    newClient = false,
    category,
    location,
    date,
    original,
    discount,
    initial,
    mode,
  }) {
    if (client !== undefined) {
      if (newClient) await this.client.type(client);
      else await this.client.pick(client);
    }
    if (category) await this.category.pick(category);
    if (location) await this.location.pick(location);
    if (date) await this.billDate.fill(date);
    if (original !== undefined) await this.originalAmount.fill(String(original));
    if (discount !== undefined) await this.discountAmount.fill(String(discount));
    if (initial !== undefined) await this.initialAmount.fill(String(initial));
    if (mode) await this.initialMode.selectOption(mode);
  }

  // Fills + submits and waits for the result message. Returns its text.
  async createBill(opts) {
    await this.fillBill(opts);
    await clearMsg(this.billMsg);
    const reloaded = this.billsReloaded();
    await this.createBillButton.click();
    await expect(this.billMsg).not.toBeEmpty();
    if (await this.isSuccess(this.billMsg)) await reloaded;
    return this.billMsg.textContent();
  }

  // Resolves when the page re-fetches GET /api/bills (it does so after
  // every successful billing action, AFTER showing the success message).
  billsReloaded() {
    const p = this.page.waitForResponse(
      (r) => r.url().endsWith("/api/bills") && r.request().method() === "GET",
      { timeout: 10_000 }
    );
    p.catch(() => {});
    return p;
  }

  async isSuccess(msg) {
    return (await msg.getAttribute("class")).includes("success");
  }

  // Extracts the bill number from a "Bill 0126100000 created for ..." message.
  static billNumberFrom(message) {
    const m = /Bill (\d{10}) created/.exec(message);
    return m && m[1];
  }

  async recordPayment({ billNumber, clientName, amount, discount, mode }) {
    await this.txBill.pick(billNumber, `${billNumber} — ${clientName}`);
    await this.txAmount.fill(String(amount));
    if (discount !== undefined) await this.txDiscount.fill(String(discount));
    if (mode) await this.txMode.selectOption(mode);
    await clearMsg(this.txMsg);
    const reloaded = this.billsReloaded();
    await this.txSubmit.click();
    await expect(this.txMsg).not.toBeEmpty();
    if (await this.isSuccess(this.txMsg)) await reloaded;
    return this.txMsg.textContent();
  }

  async selectSettleCompany(companyName) {
    await this.settleCompany.pick(companyName);
    await expect(this.settleTotal).not.toHaveText("Total selected: ₹0.00");
  }

  settleCheckbox(billNumber) {
    return rowByFirstCellAt(this.settleTable, 1, billNumber).locator(".settle-bill-checkbox");
  }

  myBillRow(billNumber) {
    return rowByFirstCell(this.billsTable, billNumber);
  }

  async myBillRows() {
    return tableRows(this.billsTable);
  }

  // Column indexes in the My Bills table.
  static get COL() {
    return {
      billNumber: 0, client: 1, category: 2, company: 3, location: 4, net: 5,
      collected: 6, discount: 7, balance: 8, status: 9, created: 10, actions: 11,
    };
  }
}

// Row in `table` whose cell at `index` is exactly `text`.
function rowByFirstCellAt(table, index, text) {
  return table.locator("tbody tr").filter({
    has: table.page().locator(`td:nth-child(${index + 1})`, { hasText: new RegExp(`^\\s*${text}\\s*$`) }),
  });
}

module.exports = { BillingPage };
