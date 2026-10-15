// admin.html: Billing tab (shared BillingPage) + Analytics + Promote +
// Reassign + Locations + Categories tabs.
const { expect } = require("@playwright/test");
const { BillingPage } = require("./billing");
const { AnalyticsSection } = require("./analytics");
const { Combobox, rowByFirstCell, tableRows, clearMsg } = require("./components");

class AdminPage extends BillingPage {
  constructor(page) {
    super(page);
    this.analytics = new AnalyticsSection(page);

    this.promote = {
      select: page.locator("#promote-user"),
      submit: page.locator('#promote-form button[type="submit"]'),
      msg: page.locator("#promote-msg"),
    };

    this.reassign = {
      bill: new Combobox(page, "reassign-bill"),
      target: page.locator("#reassign-target"),
      submit: page.locator('#reassign-form button[type="submit"]'),
      msg: page.locator("#reassign-msg"),
      historyEmpty: page.locator("#reassign-history-empty"),
      historyTable: page.locator("#reassign-history-table"),
    };

    this.locations = {
      name: page.locator("#new-location-name"),
      code: page.locator("#new-location-code"),
      submit: page.locator('#add-location-form button[type="submit"]'),
      msg: page.locator("#add-location-msg"),
      actionMsg: page.locator("#location-action-msg"),
      table: page.locator("#locations-table"),
    };

    this.categories = {
      name: page.locator("#new-category-name"),
      type: page.locator("#new-category-type"),
      companyField: page.locator("#new-category-company-field"),
      company: new Combobox(page, "new-category-company"),
      submit: page.locator('#add-category-form button[type="submit"]'),
      msg: page.locator("#add-category-msg"),
      actionMsg: page.locator("#category-action-msg"),
      table: page.locator("#categories-table"),
    };
  }

  tabButton(name) {
    return this.page.locator(`.tabs button[data-tab="${name}"]`);
  }

  // Clicks a tab and waits for the data that tab loads on open (networkidle
  // alone isn't enough: it resolves immediately once reached on page load).
  async openTab(name) {
    const loads = {
      analytics: ["/api/analytics/category-wise", "/api/analytics/client-outstanding"],
      promote: ["/api/users/operators"],
      reassign: ["/api/users/reassign-targets"],
      locations: ["/api/locations"],
      categories: ["/api/categories"],
    }[name] || [];
    const loaded = Promise.all(loads.map((path) => this.page.waitForResponse((r) => r.url().includes(path))));
    await this.tabButton(name).click();
    await expect(this.page.locator(`#tab-${name}`)).toBeVisible();
    await loaded;
  }

  // ---- Locations ----
  async addLocation(name, code) {
    await this.locations.name.fill(name);
    await this.locations.code.fill(code);
    await clearMsg(this.locations.msg);
    await this.locations.submit.click();
    await expect(this.locations.msg).not.toBeEmpty();
    return this.locations.msg.textContent();
  }

  locationRow(name) {
    return rowByFirstCell(this.locations.table, name);
  }

  // ---- Categories ----
  async addCategory({ name, type = "standard", company, pickCompany = false }) {
    await this.categories.name.fill(name);
    await this.categories.type.selectOption(type);
    if (company !== undefined) {
      if (pickCompany) await this.categories.company.pick(company);
      else await this.categories.company.type(company);
    }
    await clearMsg(this.categories.msg);
    await this.categories.submit.click();
    await expect(this.categories.msg).not.toBeEmpty();
    return this.categories.msg.textContent();
  }

  categoryRow(name) {
    return rowByFirstCell(this.categories.table, name);
  }

  async reassignHistoryRows() {
    return tableRows(this.reassign.historyTable);
  }
}

module.exports = { AdminPage };
