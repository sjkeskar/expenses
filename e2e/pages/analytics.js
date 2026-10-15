// Analytics UI shared by admin.html's Analytics tab and accountant.html
// (identical element ids on both).
const { expect } = require("@playwright/test");
const { Combobox, tableRows, rowByFirstCell } = require("./components");

const TABLES = {
  dayWise: "#day-wise-table",
  operatorWise: "#operator-wise-table",
  locationWise: "#location-wise-table",
  categoryWise: "#category-wise-table",
  clientOutstanding: "#client-outstanding-table",
  clientDaily: "#client-daily-table",
  clientLedger: "#client-ledger-table",
};

const PDF_BUTTONS = {
  dayWise: "#download-day-wise-pdf",
  operatorWise: "#download-operator-wise-pdf",
  locationWise: "#download-location-wise-pdf",
  categoryWise: "#download-category-wise-pdf",
  clientOutstanding: "#download-client-outstanding-pdf",
  clientDetail: "#download-client-detail-pdf",
  all: "#download-all-pdf",
};

class AnalyticsSection {
  constructor(page) {
    this.page = page;
    this.startDate = page.locator("#start-date");
    this.endDate = page.locator("#end-date");
    this.apply = page.locator('#date-range-form button[type="submit"]');
    this.clear = page.locator("#clear-date-range");
    this.rangeLabel = page.locator("#range-label");
    this.ledgerClient = new Combobox(page, "ledger-client");
    this.tables = Object.fromEntries(Object.entries(TABLES).map(([k, sel]) => [k, page.locator(sel)]));
    this.pdfButtons = Object.fromEntries(Object.entries(PDF_BUTTONS).map(([k, sel]) => [k, page.locator(sel)]));
  }

  async setRange(from, to = from) {
    await this.startDate.fill(from);
    await this.endDate.fill(to);
    const reloaded = this.reloaded();
    await this.apply.click();
    await reloaded;
  }

  async clearRange() {
    const reloaded = this.reloaded();
    await this.clear.click();
    await reloaded;
  }

  // Resolves once every request of an analytics refresh has completed,
  // including the per-client detail when a client is selected (it is fetched
  // only after the main tables, so networkidle alone is not enough).
  // Assertions on table contents should still use expect.poll / web-first
  // assertions, since rendering happens just after the responses arrive.
  async reloaded() {
    const withClient = (await this.ledgerClient.hidden.inputValue()) !== "";
    const waits = [
      this.page.waitForResponse((r) => r.url().includes("/api/analytics/category-wise")),
      this.page.waitForResponse((r) => r.url().includes("/api/analytics/client-outstanding")),
    ];
    if (withClient) waits.push(this.page.waitForResponse((r) => r.url().includes("/api/analytics/client-daily/")));
    return Promise.all(waits);
  }

  async rows(table) {
    return tableRows(this.tables[table]);
  }

  row(table, firstCell) {
    return rowByFirstCell(this.tables[table], firstCell);
  }

  async rowCells(table, firstCell) {
    const row = this.row(table, firstCell);
    await expect(row).toHaveCount(1);
    return row.locator("td").allTextContents().then((c) => c.map((s) => s.trim()));
  }

  async selectLedgerClient(name) {
    const loaded = this.page.waitForResponse((r) => r.url().includes("/api/analytics/client-ledger/"));
    await this.ledgerClient.pick(name);
    await loaded;
  }

  // Clicks a Download PDF button and returns the Playwright Download.
  async download(button) {
    const [download] = await Promise.all([this.page.waitForEvent("download"), this.pdfButtons[button].click()]);
    return download;
  }
}

module.exports = { AnalyticsSection };
