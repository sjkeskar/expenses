// Thin wrapper over the app's REST API, used to arrange test data quickly
// (so UI specs only drive the UI for the behaviour actually under test)
// and to exercise the permission matrix directly.
const { request } = require("@playwright/test");
const { BASELINE } = require("./seed");
const { uid, istDate } = require("./data");
const { db } = require("./db");

class ApiClient {
  constructor(ctx) {
    this.ctx = ctx;
  }

  static async create() {
    const ctx = await request.newContext({ baseURL: process.env.E2E_BASE_URL });
    return new ApiClient(ctx);
  }

  // Logs in and returns a client carrying that session cookie.
  static async as(user) {
    const client = await ApiClient.create();
    await client.login(user.name, user.password);
    return client;
  }

  async dispose() {
    await this.ctx.dispose();
  }

  // Raw call: never throws on HTTP errors. Returns { status, body }.
  async raw(method, path, body) {
    const res = await this.ctx.fetch(`/api${path}`, {
      method,
      data: body === undefined ? undefined : body,
      headers: { "Content-Type": "application/json" },
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      // no JSON body
    }
    return { status: res.status(), body: json };
  }

  // Strict call: throws with the server's error message on non-2xx.
  async call(method, path, body) {
    const { status, body: json } = await this.raw(method, path, body);
    if (status >= 400) {
      throw new Error(`${method} ${path} -> ${status}: ${json && json.error}`);
    }
    return json;
  }

  login(name, password) {
    return this.call("POST", "/auth/login", { name, password });
  }

  // ---- lookups (resolved via DB so any role can use them) ----

  async baselineLocation() {
    return db().location.findFirst({ where: { name: BASELINE.location.name } });
  }
  async baselineStandardCategory() {
    return db().category.findFirst({ where: { name: BASELINE.standardCategory.name } });
  }
  async baselineCreditCategory() {
    return db().category.findFirst({ where: { name: BASELINE.creditCategory.name } });
  }

  // ---- admin lookup-list management ----

  async addLocation({ name = uid("Loc"), locationCode = "02" } = {}) {
    return (await this.call("POST", "/locations", { name, locationCode })).location;
  }

  async addCategory({ name = uid("Cat"), type = "standard", companyName, companyId } = {}) {
    return (await this.call("POST", "/categories", { name, type, companyName, companyId })).category;
  }

  // Credit category with its own brand-new company — isolates settlement specs.
  async addCreditCategory(companyName = uid("Co")) {
    const category = await this.addCategory({ type: "credit", companyName });
    return { category, company: category.company };
  }

  // ---- billing ----

  // Defaults: new unique client, baseline location + standard category,
  // today's IST date, 1000 billed, no discount, nothing collected.
  async createBill(opts = {}) {
    const location = opts.locationId ? { id: opts.locationId } : await this.baselineLocation();
    const category = opts.categoryId ? { id: opts.categoryId } : await this.baselineStandardCategory();
    const body = {
      locationId: location.id,
      categoryId: category.id,
      originalAmount: opts.originalAmount ?? 1000,
      discountAmount: opts.discountAmount ?? 0,
      billDate: opts.billDate ?? istDate(),
    };
    if (opts.clientId) body.clientId = opts.clientId;
    else body.clientName = opts.clientName ?? uid("Client");
    if (opts.initialAmountCollected !== undefined) {
      body.initialAmountCollected = opts.initialAmountCollected;
      body.initialMode = opts.initialMode ?? "cash";
    }
    return (await this.call("POST", "/bills", body)).bill;
  }

  async pay(billId, amountCollected, { mode = "cash", discountAmount = 0 } = {}) {
    return (await this.call("POST", "/transactions", { billId, amountCollected, mode, discountAmount })).transaction;
  }

  async refund(billId) {
    return (await this.call("PATCH", `/bills/${billId}/refund`)).bill;
  }

  async settle(companyId, billIds, mode = "cash") {
    return this.call("POST", `/companies/${companyId}/settle`, { billIds, mode });
  }

  async reassign(billId, operatorId) {
    return (await this.call("PATCH", `/bills/${billId}/reassign-operator`, { operatorId })).bill;
  }

  async getBill(billId) {
    return (await this.call("GET", `/bills/${billId}`)).bill;
  }
}

module.exports = { ApiClient };
