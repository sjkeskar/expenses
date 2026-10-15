// Reusable UI components shared across role pages.
const { expect } = require("@playwright/test");
const { escapeRegex } = require("../helpers/data");

// The typeable combobox from common.js's attachCombobox(): a text input,
// a hidden id input, and a .combobox-list dropdown of .combobox-item rows.
class Combobox {
  constructor(page, baseId) {
    this.page = page;
    this.input = page.locator(`#${baseId}-input`);
    this.hidden = page.locator(`#${baseId}-id`);
    this.dropdown = page.locator(`#${baseId}-dropdown`);
    this.items = this.dropdown.locator(".combobox-item");
  }

  // Item whose main label (first span) equals `label` exactly.
  item(label) {
    return this.items.filter({
      has: this.page.locator("span:first-child", { hasText: new RegExp(`^${escapeRegex(label)}$`) }),
    });
  }

  // Types `query`, then clicks the suggestion labelled `label` (defaults to
  // the query itself). Fails if that suggestion never appears.
  async pick(query, label = query) {
    await this.input.fill(query);
    await this.item(label).click();
    await expect(this.hidden).not.toHaveValue("");
  }

  // Types free text without picking anything (e.g. a brand-new client name).
  async type(text) {
    await this.input.fill(text);
    await this.input.press("Escape");
  }

  async labels() {
    return this.items.locator("span:first-child").allTextContents();
  }
}

class ChangePasswordModal {
  constructor(page) {
    this.page = page;
    this.openButton = page.locator("#change-password-btn");
    this.modal = page.locator("#change-password-modal");
    this.current = this.modal.locator("#current-password");
    this.next = this.modal.locator("#new-password");
    this.confirm = this.modal.locator("#confirm-new-password");
    this.submit = this.modal.locator('button[type="submit"]');
    this.cancel = page.locator("#change-password-cancel");
    this.msg = page.locator("#change-password-msg");
  }

  async open() {
    await this.openButton.click();
    await expect(this.modal).toBeVisible();
  }

  async change(current, next, confirm = next) {
    await this.open();
    await this.current.fill(current);
    await this.next.fill(next);
    await this.confirm.fill(confirm);
    await clearMsg(this.msg);
    await this.submit.click();
  }
}

class RefundModal {
  constructor(page) {
    this.modal = page.locator("#refund-modal");
    this.details = page.locator("#refund-modal-details");
    this.confirm = page.locator("#refund-modal-confirm");
    this.cancel = page.locator("#refund-modal-cancel");
    this.msg = page.locator("#refund-modal-msg");
  }
}

// Empties a result-message element so a following "not empty" wait can only
// be satisfied by the response to the action about to be taken.
async function clearMsg(msg) {
  await msg.evaluate((el) => {
    el.textContent = "";
    el.className = "msg";
  });
}

// Reads a <table>'s body into arrays of trimmed cell text.
async function tableRows(table) {
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((r) => Array.from(r.querySelectorAll("td")).map((td) => td.textContent.trim()))
  );
}

// The <tr> whose first cell is exactly `firstCell`.
function rowByFirstCell(table, firstCell) {
  return table.locator("tbody tr").filter({
    has: table.page().locator("td:first-child", { hasText: new RegExp(`^\\s*${escapeRegex(firstCell)}\\s*$`) }),
  });
}

module.exports = { Combobox, ChangePasswordModal, RefundModal, tableRows, rowByFirstCell, clearMsg };
