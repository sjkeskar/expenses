// Thin wrapper over the app's REST API: arranges test data quickly and
// exercises the permission matrix directly.
const { request } = require("@playwright/test");
const { uid, phone, istDate } = require("./data");
const { db, baseline } = require("./db");

class ApiClient {
  constructor(ctx) {
    this.ctx = ctx;
  }

  static async create() {
    return new ApiClient(await request.newContext({ baseURL: process.env.E2E_BASE_URL }));
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
    if (status >= 400) throw new Error(`${method} ${path} -> ${status}: ${json && json.error}`);
    return json;
  }

  login(name, password) {
    return this.call("POST", "/auth/login", { name, password });
  }

  // ---- patients ----

  // A new, unique patient (age 30 by default).
  async registerPatient(fields = {}) {
    const body = { name: uid("Pat"), sex: "female", ageYears: 30, phone: phone(), ...fields };
    return (await this.call("POST", "/patients", body)).patient;
  }

  // ---- billing ----

  // Defaults: a new patient, CBC only, walk-in, self-pay, the baseline branch,
  // today, no discount, nothing collected. `items` are catalog codes.
  async createBill({ items = ["CBC"], patientId, ...opts } = {}) {
    const itemIds = await Promise.all(items.map(async (code) => (await baseline.item(code)).id));
    const body = {
      patientId: patientId ?? (await this.registerPatient()).id,
      itemIds,
      referralType: "walk_in",
      payerType: "self",
      locationId: opts.locationId ?? (await baseline.branch()).id,
      billDate: istDate(),
      ...opts,
    };
    return (await this.call("POST", "/bills", body)).bill;
  }

  // Defaults: CBC only, for a name and phone (no patient record), walk-in,
  // self-pay, at the baseline branch. `items` are catalog codes.
  async createQuote({ items = ["CBC"], ...opts } = {}) {
    const itemIds = await Promise.all(items.map(async (code) => (await baseline.item(code)).id));
    const body = {
      patientName: uid("Quoted"),
      patientPhone: phone(),
      itemIds,
      referralType: "walk_in",
      payerType: "self",
      locationId: opts.locationId ?? (await baseline.branch()).id,
      ...opts,
    };
    return (await this.call("POST", "/quotations", body)).quotation;
  }

  async pay(billId, amountCollected, { mode = "cash", discountAmount = 0 } = {}) {
    return (await this.call("POST", "/transactions", { billId, amountCollected, mode, discountAmount })).transaction;
  }

  // itemCodes: which of the bill's lines to cancel, by code.
  async cancel(bill, itemCodes, { reason = "Patient request", ...opts } = {}) {
    const itemIds = bill.items.filter((i) => itemCodes.includes(i.code)).map((i) => i.id);
    return (await this.call("PATCH", `/bills/${bill.id}/cancel-items`, { itemIds, reason, ...opts })).bill;
  }

  async getBill(billId) {
    return (await this.call("GET", `/bills/${billId}`)).bill;
  }

  // ---- approvals ----

  // The approval behind a bill's discount or cancellation, or a subject id.
  async approvalFor({ billId, subjectId, subjectType }) {
    return db().approval.findFirst({
      where: { ...(billId && { billId }), ...(subjectId && { subjectId }), subjectType },
      orderBy: { requestedAt: "desc" },
    });
  }

  decide(approvalId, decision, note) {
    return this.call("POST", `/approvals/${approvalId}/${decision}`, { note });
  }

  // ---- lead's lists ----

  // A new branch with a free random code (codes are unique).
  async addLocation(fields = {}) {
    for (;;) {
      const body = { name: uid("Loc"), type: "branch", address: "E2E Street", locationCode: String(10 + Math.floor(Math.random() * 90)), ...fields };
      const { status, body: json } = await this.raw("POST", "/locations", body);
      if (status === 201) return json.location;
      if (!(status === 409 && /code/.test(json.error) && !fields.locationCode)) throw new Error(`addLocation -> ${status}: ${json.error}`);
    }
  }

  async addPanel(fields = {}) {
    return (await this.call("POST", "/panels", { name: uid("Panel"), type: "corporate", ...fields })).panel;
  }
}

module.exports = { ApiClient };
