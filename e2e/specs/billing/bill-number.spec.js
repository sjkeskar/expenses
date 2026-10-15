// D14–D16 + L1: bill-number format {locationCode}{YY}{MM}{seq}, per-code
// monthly sequences, month/year rollover, the 9999 cap, and uniqueness under
// concurrent creation.
//
// Every test here owns a distinct (location code, month) bucket so its
// sequence numbers are deterministic even with parallel workers.
const { test, expect } = require("../../fixtures");
const { BillingPage } = require("../../pages/billing");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { uid, billPrefix } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");

// Dates/numbers shift by 20 years per --repeat-each run so repeats own fresh buckets.
const Y = (year) => year - 20 * test.info().repeatEachIndex;
const day = (iso) => `${Y(Number(iso.slice(0, 4)))}${iso.slice(4)}`;
const num = (code, iso, seq) => `${billPrefix(code, day(iso))}${String(seq).padStart(4, "0")}`;

test.describe("Bill numbers", () => {
  test("D14: first bill of a month is …0000, the next …0001 (via the UI)", async ({ loginAs, users, adminApi }) => {
    const loc = await adminApi.addLocation({ locationCode: "90" });
    const ui = new BillingPage(await loginAs(users.op1));
    const make = () =>
      ui.createBill({
        client: uid("Num"), newClient: true, category: BASELINE.standardCategory.name,
        location: loc.name, date: day("2019-03-10"), original: 10,
      });
    const first = BillingPage.billNumberFrom(await make());
    const second = BillingPage.billNumberFrom(await make());
    expect(first).toBe(num("90", "2019-03-10", 0));
    expect(second).toBe(num("90", "2019-03-10", 1));
    expect(first.startsWith(billPrefix("90", day("2019-03-10")))).toBe(true);
  });

  test("D15: two locations sharing a code share one sequence", async ({ adminApi }) => {
    const a = await adminApi.addLocation({ locationCode: "91" });
    const b = await adminApi.addLocation({ locationCode: "91" });
    const numbers = [];
    for (const loc of [a, b, a]) {
      numbers.push((await adminApi.createBill({ locationId: loc.id, billDate: day("2019-04-20") })).billNumber);
    }
    expect(numbers).toEqual([0, 1, 2].map((i) => num("91", "2019-04-20", i)));
  });

  test("D15b: different codes in the same month have independent sequences", async ({ adminApi }) => {
    const a = await adminApi.addLocation({ locationCode: "92" });
    const b = await adminApi.addLocation({ locationCode: "93" });
    const na = (await adminApi.createBill({ locationId: a.id, billDate: day("2019-05-01") })).billNumber;
    const nb = (await adminApi.createBill({ locationId: b.id, billDate: day("2019-05-01") })).billNumber;
    expect(na).toBe(num("92", "2019-05-01", 0));
    expect(nb).toBe(num("93", "2019-05-01", 0));
  });

  test("D16: sequence resets at a month boundary and across a year boundary", async ({ adminApi }) => {
    const loc = await adminApi.addLocation({ locationCode: "94" });
    const make = async (billDate) => (await adminApi.createBill({ locationId: loc.id, billDate: day(billDate) })).billNumber;
    expect(await make("2019-12-31")).toBe(num("94", "2019-12-31", 0));
    expect(await make("2020-01-01")).toBe(num("94", "2020-01-01", 0));
    expect(await make("2019-12-01")).toBe(num("94", "2019-12-01", 1)); // back in December's bucket
    expect(await make("2020-02-29")).toBe(num("94", "2020-02-29", 0)); // leap day (2000, 1980… are leap years too)
  });

  test("D16c: a location's code change on revival applies to new bills only", async ({ adminApi }) => {
    const loc = await adminApi.addLocation({ locationCode: "95" });
    const before = (await adminApi.createBill({ locationId: loc.id, billDate: day("2019-07-01") })).billNumber;
    await adminApi.call("DELETE", `/locations/${loc.id}`);
    await adminApi.addLocation({ name: loc.name, locationCode: "96" });
    const after = (await adminApi.createBill({ locationId: loc.id, billDate: day("2019-07-01") })).billNumber;
    expect(before).toBe(num("95", "2019-07-01", 0));
    expect(after).toBe(num("96", "2019-07-01", 0));
  });

  test("D14b: the 9999 monthly cap is enforced and the failed attempt does not burn a number", async ({ adminApi }) => {
    const loc = await adminApi.addLocation({ locationCode: "97" });
    const key = billPrefix("97", day("2019-08-05"));
    await db().billCounter.create({ data: { counterKey: key, lastSequence: 9998 } });

    expect((await adminApi.createBill({ locationId: loc.id, billDate: day("2019-08-05") })).billNumber).toBe(num("97", "2019-08-05", 9999));

    const cat = await adminApi.baselineStandardCategory();
    const { status, body } = await adminApi.raw("POST", "/bills", {
      clientName: uid("Cap"), locationId: loc.id, categoryId: cat.id, originalAmount: 5, billDate: day("2019-08-06"),
    });
    expect(status).toBe(500);
    expect(body.error).toBe(
      "Monthly bill sequence limit (9999) reached for this location code. Contact your developer/admin."
    );
    const counter = await db().billCounter.findUnique({ where: { counterKey: key } });
    expect(counter.lastSequence).toBe(9999);
  });

  test("L1: six operators creating bills at the same instant get unique, gap-free numbers", async ({ adminApi }) => {
    const loc = await adminApi.addLocation({ locationCode: "98" });
    const operators = await Promise.all(Array.from({ length: 6 }, () => createUser("operator")));
    const sessions = await Promise.all(operators.map((o) => ApiClient.as(o)));
    try {
      const bills = await Promise.all(
        sessions.flatMap((s) => [
          s.createBill({ locationId: loc.id, billDate: day("2019-09-09") }),
          s.createBill({ locationId: loc.id, billDate: day("2019-09-09") }),
        ])
      );
      const numbers = bills.map((b) => b.billNumber).sort();
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => num("98", "2019-09-09", i)));
    } finally {
      await Promise.all(sessions.map((s) => s.dispose()));
    }
  });
});
