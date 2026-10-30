// Panel price lists, camps (pivot.md §4.5, §4.7) and panel settlement.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 60 * 60 * 1000;

async function camp(leadApi, fields = {}) {
  const panel = await leadApi.addPanel();
  const branch = await baseline.branch();
  const body = { panelId: panel.id, name: uid("Camp"), locationId: branch.id, startsAt: iso(-HOUR), endsAt: iso(HOUR), ...fields };
  return { panel, camp: (await leadApi.call("POST", "/camps", body)).camp };
}

test.describe("Pricing", () => {
  test("a panel's standing list: its custom prices, else its % off the catalog", async ({ techApi }) => {
    const insurer = await baseline.insurer();
    const bill = await techApi.createBill({ items: ["CBC", "GLUF", "LIPID"], payerType: "panel", panelId: insurer.id });
    expect(bill.items.map((i) => [i.code, i.price])).toEqual([["CBC", "250"], ["GLUF", "90"], ["LIPID", "225"]]);
  });

  test("a panel without special rates is billed at catalog price", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC"], payerType: "panel", panelId: (await baseline.panel()).id });
    expect(bill.items[0].price).toBe("300");
  });

  test("a running camp's rates beat the panel's standing list", async ({ leadApi, techApi }) => {
    const cbc = await baseline.item("CBC");
    const { panel, camp: c } = await camp(leadApi, { discountPercent: 50, items: [{ catalogItemId: cbc.id, price: 120 }] });
    await leadApi.call("PUT", `/panels/${panel.id}/price-list`, { discountPercent: 5 });
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], payerType: "panel", panelId: panel.id, campId: c.id });
    expect(bill.items.map((i) => i.price)).toEqual(["120", "50"]);
    expect(bill.camp.id).toBe(c.id);
  });

  test("a camp bill uses the camp's location; a camp outside its period is refused", async ({ leadApi, techApi }) => {
    const { panel, camp: running } = await camp(leadApi);
    const centre = await baseline.centre();
    const wrongPlace = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: [(await baseline.item("CBC")).id], referralType: "walk_in",
      payerType: "panel", panelId: panel.id, campId: running.id, locationId: centre.id,
    });
    expect(wrongPlace.body.error).toMatch(/camp's location/);

    const { panel: p2, camp: ended } = await camp(leadApi, { startsAt: iso(-3 * HOUR), endsAt: iso(-2 * HOUR) });
    const late = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: [(await baseline.item("CBC")).id], referralType: "walk_in",
      payerType: "panel", panelId: p2.id, campId: ended.id,
    });
    expect(late.body.error).toMatch(/isn't running/);
  });

  test("a camp must belong to the bill's panel", async ({ leadApi, techApi }) => {
    const { camp: c } = await camp(leadApi);
    const { status, body } = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: [(await baseline.item("CBC")).id], referralType: "walk_in",
      payerType: "panel", panelId: (await baseline.panel()).id, campId: c.id,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/camp of this panel/);
  });

  test("editing a price list affects new bills only", async ({ leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const cbc = await baseline.item("CBC");
    await leadApi.call("PUT", `/panels/${panel.id}/price-list`, { items: [{ catalogItemId: cbc.id, price: 200 }] });
    const before = await techApi.createBill({ payerType: "panel", panelId: panel.id });
    await leadApi.call("PUT", `/panels/${panel.id}/price-list`, {});
    const after = await techApi.createBill({ payerType: "panel", panelId: panel.id });
    expect((await techApi.getBill(before.id)).items[0].price).toBe("200");
    expect(after.items[0].price).toBe("300");
  });

  test("price lists are validated", async ({ leadApi }) => {
    const panel = await leadApi.addPanel();
    const cbc = await baseline.item("CBC");
    for (const [body, error] of [
      [{ discountPercent: 120 }, /between 0 and 100/],
      [{ items: [{ catalogItemId: cbc.id, price: 1 }, { catalogItemId: cbc.id, price: 2 }] }, /one special price/],
      [{ items: [{ catalogItemId: "00000000-0000-0000-0000-000000000000", price: 1 }] }, /active catalog items/],
      [{ items: [{ catalogItemId: cbc.id, price: -1 }] }, /non-negative/],
    ]) {
      const res = await leadApi.raw("PUT", `/panels/${panel.id}/price-list`, body);
      expect.soft(res.status).toBe(400);
      expect.soft(res.body.error).toMatch(error);
    }
  });
});

test.describe("Panel settlement", () => {
  test("settles hand-picked bills in full; skipped ones stay pending", async ({ leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const bills = await Promise.all([1, 2, 3].map(() => techApi.createBill({ payerType: "panel", panelId: panel.id })));
    const { pendingBills } = await techApi.call("GET", `/panels/${panel.id}/outstanding`);
    expect(pendingBills).toHaveLength(3);

    const result = await techApi.call("POST", `/panels/${panel.id}/settle`, { billIds: [bills[0].id, bills[2].id], mode: "upi" });
    expect(result.totalSettled).toBe(600);
    expect((await techApi.getBill(bills[0].id)).status).toBe("fully_paid");
    expect((await techApi.getBill(bills[1].id)).status).toBe("pending");
    const settlement = await db().transaction.findFirst({ where: { billId: bills[0].id } });
    expect(settlement).toMatchObject({ kind: "settlement", mode: "upi" });
  });

  test("is all-or-nothing: another panel's or a non-pending bill fails the whole settlement", async ({ leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const mine = await techApi.createBill({ payerType: "panel", panelId: panel.id });
    const other = await techApi.createBill({ payerType: "panel", panelId: (await baseline.panel()).id });
    const paid = await techApi.createBill({ payerType: "panel", panelId: panel.id, initialPayment: { amount: 300, mode: "cash" } });
    for (const [billIds, error] of [
      [[mine.id, other.id], /does not belong to this panel/],
      [[mine.id, paid.id], /is not pending/],
      [[mine.id, mine.id], /only be selected once/],
    ]) {
      const res = await techApi.raw("POST", `/panels/${panel.id}/settle`, { billIds, mode: "cash" });
      expect.soft(res.status).toBe(400);
      expect.soft(res.body.error).toMatch(error);
    }
    expect((await techApi.getBill(mine.id)).status).toBe("pending");
  });

  test("a partly cancelled panel bill settles only its new balance", async ({ leadApi, techApi }) => {
    const panel = await leadApi.addPanel();
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], payerType: "panel", panelId: panel.id });
    await techApi.cancel(bill, ["CBC"]);
    const result = await techApi.call("POST", `/panels/${panel.id}/settle`, { billIds: [bill.id], mode: "cash" });
    expect(result.totalSettled).toBe(100);
  });
});
