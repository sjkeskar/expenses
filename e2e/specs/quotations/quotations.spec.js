// Quotations (pivot.md §4.9): 48 h validity, reserved prices, conversion
// into a bill, re-issue, and their verification codes.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid, istDate, billPrefix } = require("../../helpers/data");

const HOUR = 60 * 60 * 1000;
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

// A throwaway test of the lead's (applied at once), so its price can change.
async function ownTest(leadApi, price = 400) {
  const code = uid("Q").replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase();
  await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: "E2E quoted test", kind: "test", price } }] });
  return db().catalogItem.findUnique({ where: { code } });
}

async function reprice(leadApi, item, price) {
  await leadApi.call("POST", "/catalog/changes", {
    changes: [{ action: "update", catalogItemId: item.id, values: { code: item.code, name: item.name, kind: "test", price } }],
  });
}

// Moves a quote's issue time back, as if it had been issued `hours` ago.
async function age(quote, hours) {
  const issuedAt = new Date(Date.now() - hours * HOUR);
  await db().quotation.update({ where: { id: quote.id }, data: { issuedAt, validUntil: new Date(issuedAt.getTime() + 48 * HOUR) } });
}

const convert = (client, quote, patientId, extra = {}) => client.raw("POST", "/bills", { quotationId: quote.id, patientId, ...extra });

test.describe("Issuing", () => {
  test("a quote gets a Q number, a verification code and 48 h; it's priced like a bill", async ({ techApi }) => {
    const quote = await techApi.createQuote({ items: ["CBC", "LIPID"], discountAmount: 50 });
    const branch = await baseline.branch();
    expect(quote.quoteNumber.startsWith(`Q${billPrefix(branch.locationCode, istDate())}`)).toBe(true);
    expect(quote.verificationCode).toMatch(/^[A-Z2-9]{12}$/);
    expect(new Date(quote.validUntil) - new Date(quote.issuedAt)).toBe(48 * HOUR);
    expect(quote.items.map((i) => [i.code, i.price])).toEqual([["CBC", "300"], ["LIPID", "250"]]);
    expect(quote).toMatchObject({ originalAmount: "550", discountAmount: "50", netAmount: "500", status: "open", expired: false, patientId: null });
    expect(quote.conversion).toEqual({ allowed: true });
  });

  test("for a registered patient it takes their name and phone; a bad phone or no name is refused", async ({ techApi }) => {
    const patient = await techApi.registerPatient();
    const quote = await techApi.createQuote({ patientId: patient.id, patientName: undefined, patientPhone: undefined });
    expect(quote).toMatchObject({ patientId: patient.id, patientName: patient.name, patientPhone: patient.phone });
    expect((await techApi.raw("POST", "/quotations", { itemIds: [], patientName: " " })).body.error).toMatch(/patient's name/);
    const bad = await techApi.raw("POST", "/quotations", { patientName: "X", patientPhone: "123", itemIds: [] });
    expect(bad.body.error).toMatch(/10-digit/);
  });

  test("a home visit adds the location's charge; a location without one can't quote it", async ({ techApi }) => {
    const quote = await techApi.createQuote({ collectionMode: "home_visit", homeVisitCharge: 260 });
    expect(quote.items.map((i) => [i.code, i.price])).toEqual([["CBC", "300"], ["HOMEVISIT", "260"]]);
    const quiet = await baseline.noVisitBranch();
    const { status, body } = await techApi.raw("POST", "/quotations", {
      patientName: "X", itemIds: [(await baseline.item("CBC")).id], referralType: "walk_in", payerType: "self",
      locationId: quiet.id, collectionMode: "home_visit",
    });
    expect([status, body.error]).toEqual([400, `${quiet.name} doesn't offer home visits.`]);
  });

  test("the discount can't exceed the total", async ({ techApi }) => {
    await expect(techApi.createQuote({ discountAmount: 301 })).rejects.toThrow(/can't exceed/);
  });
});

test.describe("Converting", () => {
  test("within 48 h at the quoted prices, even after a price change; it can't convert twice", async ({ techApi, leadApi }) => {
    const item = await ownTest(leadApi, 400);
    const quote = await techApi.createQuote({ items: [item.code], discountAmount: 40 });
    await reprice(leadApi, item, 450);

    const patient = await techApi.registerPatient();
    const { status, body } = await convert(techApi, quote, patient.id, { initialPayment: { amount: 100, mode: "cash" } });
    expect(status).toBe(201);
    expect(body.bill.items.map((i) => [i.code, i.price])).toEqual([[item.code, "400"]]);
    expect(body.bill).toMatchObject({ quotationId: quote.id, originalAmount: "400", discountAmount: "40", netAmount: "360", balance: "260" });
    // The quote's discount was a proposal; the bill's approval starts now.
    expect(body.bill.holds).toEqual(["Discount awaiting approval"]);

    const after = (await techApi.call("GET", `/quotations/${quote.id}`)).quotation;
    expect(after).toMatchObject({ status: "converted", patientId: patient.id, bill: { id: body.bill.id } });
    expect(after.conversion.allowed).toBe(false);
    expect((await convert(techApi, quote, patient.id)).status).toBe(409);
  });

  test("the bill takes the quote's items, referral, payer and place, not the request's", async ({ techApi }) => {
    const insurer = await baseline.insurer();
    const quote = await techApi.createQuote({ items: ["CBC", "GLUF"], payerType: "panel", panelId: insurer.id });
    const patient = await techApi.registerPatient();
    const { body } = await convert(techApi, quote, patient.id, { itemIds: [(await baseline.item("TG")).id], payerType: "self", discountAmount: 100 });
    expect(body.bill.items.map((i) => [i.code, i.price])).toEqual([["CBC", "250"], ["GLUF", "90"]]);
    expect(body.bill).toMatchObject({ payerType: "panel", panelId: insurer.id, discountAmount: "0" });
  });

  test("expired with unchanged prices still converts; expired with a changed price must be re-issued", async ({ techApi, leadApi }) => {
    const [steady, repriced] = [await ownTest(leadApi, 300), await ownTest(leadApi, 300)];
    const unchanged = await techApi.createQuote({ items: [steady.code] });
    const changed = await techApi.createQuote({ items: [repriced.code] });
    await age(unchanged, 49);
    await age(changed, 49);
    await reprice(leadApi, repriced, 320);

    expect((await techApi.call("GET", `/quotations/${unchanged.id}`)).quotation).toMatchObject({ expired: true, conversion: { allowed: true } });
    expect((await techApi.call("GET", `/quotations/${changed.id}`)).quotation.conversion).toMatchObject({ allowed: false, reissue: true });
    const patient = await techApi.registerPatient();
    const refused = await convert(techApi, changed, patient.id);
    expect([refused.status, refused.body.reissue]).toEqual([409, true]);
    const ok = await convert(techApi, unchanged, patient.id);
    expect([ok.status, ok.body.bill.items[0].price]).toEqual([201, "300"]);
  });

  test("re-issue: a new quote at today's prices for 48 h; the old one stays, unconvertible", async ({ techApi, leadApi }) => {
    const item = await ownTest(leadApi, 500);
    const old = await techApi.createQuote({ items: [item.code, "CBC"], discountAmount: 100 });
    expect((await techApi.raw("POST", `/quotations/${old.id}/reissue`)).status).toBe(409); // still valid
    await age(old, 50);
    await reprice(leadApi, item, 550);

    const { status, body } = await techApi.raw("POST", `/quotations/${old.id}/reissue`);
    expect(status).toBe(201);
    const fresh = body.quotation;
    expect(fresh.quoteNumber).not.toBe(old.quoteNumber);
    expect(fresh).toMatchObject({ patientName: old.patientName, discountAmount: "100", netAmount: "750", expired: false, reissuedFrom: { id: old.id } });
    expect(fresh.items.map((i) => [i.code, i.price])).toEqual([[item.code, "550"], ["CBC", "300"]]);

    const history = (await techApi.call("GET", `/quotations/${old.id}`)).quotation;
    expect(history).toMatchObject({ status: "open", expired: true, reissuedAs: { id: fresh.id }, conversion: { allowed: false } });
    expect((await techApi.raw("POST", `/quotations/${old.id}/reissue`)).status).toBe(409);
    expect((await convert(techApi, old, (await techApi.registerPatient()).id)).status).toBe(409);
  });

  test("a camp quote keeps its camp prices within 48 h after the camp ends; a direct bill can't", async ({ techApi, leadApi }) => {
    const panel = await leadApi.addPanel();
    const cbc = await baseline.item("CBC");
    const { camp } = await leadApi.call("POST", "/camps", {
      panelId: panel.id, name: uid("Camp"), locationId: (await baseline.branch()).id,
      startsAt: iso(-3 * HOUR), endsAt: iso(HOUR), items: [{ catalogItemId: cbc.id, price: 99 }],
    });
    const quote = await techApi.createQuote({ payerType: "panel", panelId: panel.id, campId: camp.id });
    expect(quote.items[0].price).toBe("99");
    // Issued an hour ago; the camp ended half an hour ago.
    await age(quote, 1);
    await db().camp.update({ where: { id: camp.id }, data: { endsAt: new Date(Date.now() - HOUR / 2) } });

    const patient = await techApi.registerPatient();
    const direct = await techApi.raw("POST", "/bills", {
      patientId: patient.id, itemIds: [cbc.id], referralType: "walk_in", payerType: "panel", panelId: panel.id, campId: camp.id, locationId: camp.locationId,
    });
    expect([direct.status, direct.body.error]).toEqual([400, "This camp isn't running at that time."]);
    const { status, body } = await convert(techApi, quote, patient.id);
    expect(status, body.error).toBe(201);
    expect([body.bill.items[0].price, body.bill.campId]).toEqual(["99", camp.id]);
  });

  test("a quote for one patient can't be billed to another; a cancelled quote can't convert", async ({ techApi }) => {
    const [a, b] = [await techApi.registerPatient(), await techApi.registerPatient()];
    const quote = await techApi.createQuote({ patientId: a.id });
    expect((await convert(techApi, quote, b.id)).body.error).toBe("This quotation is for another patient.");

    const other = await techApi.createQuote();
    expect((await techApi.call("POST", `/quotations/${other.id}/cancel`)).quotation.status).toBe("cancelled");
    expect((await techApi.raw("POST", `/quotations/${other.id}/cancel`)).status).toBe(409);
    expect((await convert(techApi, other, a.id)).status).toBe(409);
  });

  test("the bill preview shows what a quote converts into", async ({ techApi }) => {
    const quote = await techApi.createQuote({ items: ["LIPID", "CHOL"], discountAmount: 20 });
    const preview = await techApi.call("POST", "/bills/preview", { quotationId: quote.id });
    expect(preview).toMatchObject({ originalAmount: "400.00", discountAmount: "20.00", netAmount: "380.00" });
    expect(preview.warnings).toEqual(["CHOL is billed twice: in LIPID and CHOL."]);
  });
});

test.describe("Listing and verifying", () => {
  test("search by number, name or phone; filter by status, expired derived", async ({ techApi }) => {
    const quote = await techApi.createQuote();
    const list = async (query) => (await techApi.call("GET", `/quotations?${query}`)).quotations.map((q) => q.id);
    expect(await list(`q=${quote.quoteNumber}`)).toEqual([quote.id]);
    expect(await list(`q=${quote.patientName}`)).toEqual([quote.id]);
    expect(await list(`q=${quote.patientPhone}`)).toEqual([quote.id]);
    expect(await list(`q=${quote.patientPhone}&status=open`)).toEqual([quote.id]);
    await age(quote, 49);
    expect(await list(`q=${quote.patientPhone}&status=open`)).toEqual([]);
    expect(await list(`q=${quote.patientPhone}&status=expired`)).toEqual([quote.id]);
  });

  test("the list says which quotes can be converted now", async ({ techApi, leadApi }) => {
    const item = await ownTest(leadApi, 200);
    const [fresh, stale, done] = [await techApi.createQuote(), await techApi.createQuote({ items: [item.code] }), await techApi.createQuote()];
    await age(stale, 49);
    await reprice(leadApi, item, 210);
    await convert(techApi, done, (await techApi.registerPatient()).id);
    const { quotations } = await techApi.call("GET", "/quotations");
    const convertible = (q) => quotations.find((r) => r.id === q.id).convertible;
    expect([convertible(fresh), convertible(stale), convertible(done)]).toEqual([true, false, false]);
  });

  test("a quote's code verifies, with its validity", async ({ techApi }) => {
    const quote = await techApi.createQuote();
    const { document } = await techApi.call("GET", `/verify/${quote.verificationCode}`);
    expect(document).toMatchObject({ type: "quotation", number: quote.quoteNumber, status: "open", patient: { name: quote.patientName }, netAmount: "300" });
    await age(quote, 49);
    expect((await techApi.call("GET", `/verify/${quote.verificationCode}`)).document.status).toBe("expired");
  });
});
