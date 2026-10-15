// login.html
class LoginPage {
  constructor(page) {
    this.page = page;
    this.name = page.locator("#name");
    this.password = page.locator("#password");
    this.submit = page.locator('#login-form button[type="submit"]');
    this.msg = page.locator("#msg");
  }

  async goto() {
    await this.page.goto("/login.html");
  }

  async login(name, password) {
    await this.name.fill(name);
    await this.password.fill(password);
    await this.submit.click();
  }
}

module.exports = { LoginPage };
