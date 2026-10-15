// developer.html: Create User + All Users table (promote/demote/deactivate).
const { expect } = require("@playwright/test");
const { ChangePasswordModal, rowByFirstCell, clearMsg } = require("./components");

class DeveloperPage {
  constructor(page) {
    this.page = page;
    this.name = page.locator("#create-user-form #new-name");
    this.password = page.locator("#create-user-form #new-password");
    this.role = page.locator("#new-role");
    this.submit = page.locator('#create-user-form button[type="submit"]');
    this.createMsg = page.locator("#create-msg");
    this.actionMsg = page.locator("#action-msg");
    this.usersTable = page.locator("#users-table");
    this.changePassword = new ChangePasswordModal(page);
    this.logout = page.locator("#logout-btn");
  }

  async createUser(name, password, role) {
    await this.name.fill(name);
    await this.password.fill(password);
    await this.role.selectOption(role);
    await clearMsg(this.createMsg);
    await this.submit.click();
    await expect(this.createMsg).not.toBeEmpty();
    return this.createMsg.textContent();
  }

  userRow(name) {
    return rowByFirstCell(this.usersTable, name);
  }

  actionButton(name, label) {
    return this.userRow(name).getByRole("button", { name: label });
  }
}

module.exports = { DeveloperPage };
