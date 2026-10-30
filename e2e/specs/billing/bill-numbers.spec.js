// Bill numbers {locationCode}{YY}{MM}{seq}: per-code monthly sequences,
// month/year rollover, the 9999 cap, uniqueness under concurrent creation.
// Every test owns a fresh location (codes are unique), so its sequence is
// deterministic even with parallel workers.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { billPrefix } = require("../../helpers/data");

const num = (code, iso, seq) => `${billPrefix(code, iso)}${String(seq).padStart(4, "0")}`;

test.describe("Bill numbers", () => {
  test("the first bill of a month is …0000, the next …0001", async ({ leadApi, techApi }) => {
    const loc = await leadApi.addLocation();
    const make = async () => (await techApi.createBill({ locationId: loc.id, billDate: "2019-03-10" })).billNumber;
    expect([await make(), await make()]).toEqual([num(loc.locationCode, "2019-03-10", 0), num(loc.locationCode, "2019-03-10", 1)]);
  });

  test("the sequence resets each month and across a year", async ({ leadApi, techApi }) => {
    const loc = await leadApi.addLocation();
    const make = async (billDate) => (await techApi.createBill({ locationId: loc.id, billDate })).billNumber;
    expect(await make("2019-12-31")).toBe(num(loc.locationCode, "2019-12-31", 0));
    expect(await make("2020-01-01")).toBe(num(loc.locationCode, "2020-01-01", 0));
    expect(await make("2019-12-01")).toBe(num(loc.locationCode, "2019-12-01", 1));
    expect(await make("2020-02-29")).toBe(num(loc.locationCode, "2020-02-29", 0));
  });

  test("the 9999 monthly cap is enforced and the failed attempt doesn't burn a number", async ({ leadApi, techApi }) => {
    const loc = await leadApi.addLocation();
    const key = billPrefix(loc.locationCode, "2019-08-05");
    await db().billCounter.create({ data: { counterKey: key, lastSequence: 9998 } });
    expect((await techApi.createBill({ locationId: loc.id, billDate: "2019-08-05" })).billNumber).toBe(num(loc.locationCode, "2019-08-05", 9999));

    const patient = await techApi.registerPatient();
    const cbc = await db().catalogItem.findUnique({ where: { code: "CBC" } });
    const { status, body } = await techApi.raw("POST", "/bills", {
      patientId: patient.id, itemIds: [cbc.id], referralType: "walk_in", payerType: "self", locationId: loc.id, billDate: "2019-08-06",
    });
    expect(status).toBe(500);
    expect(body.error).toMatch(/limit \(9999\) reached/);
    expect((await db().billCounter.findUnique({ where: { counterKey: key } })).lastSequence).toBe(9999);
  });

  test("six technicians creating bills at the same instant get unique, gap-free numbers", async ({ leadApi }) => {
    const loc = await leadApi.addLocation();
    const sessions = await Promise.all(Array.from({ length: 6 }, () => createUser("technician").then((u) => ApiClient.as(u))));
    try {
      const bills = await Promise.all(
        sessions.flatMap((s) => [1, 2].map(() => s.createBill({ locationId: loc.id, billDate: "2019-09-09" })))
      );
      expect(bills.map((b) => b.billNumber).sort()).toEqual(Array.from({ length: 12 }, (_, i) => num(loc.locationCode, "2019-09-09", i)));
    } finally {
      await Promise.all(sessions.map((s) => s.dispose()));
    }
  });
});
