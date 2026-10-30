// The catalog (pivot.md §4.6) and referring doctors (§4.5): proposals by
// technicians and pathologists, approval by the lead.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { uid } = require("../../helpers/data");

const code = () => uid("T").replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase();
const test_ = (overrides = {}) => ({ code: code(), name: "E2E test", kind: "test", price: 120, draws: ["Single"], ...overrides });
const inCatalog = async (client, c) => (await client.call("GET", "/catalog")).items.find((i) => i.code === c);

test.describe("Catalog changes", () => {
  test("a technician's new test waits for the lead; approved, it's in the catalog", async ({ techApi, leadApi }) => {
    const values = test_({ machineSteps: [{ sequence: 1, machineTypeId: (await baseline.machineType()).id }] });
    const { approvals } = await techApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values }] });
    expect(approvals[0].status).toBe("pending");
    expect(await inCatalog(techApi, values.code)).toBeUndefined();

    await leadApi.decide(approvals[0].id, "approve");
    const item = await inCatalog(techApi, values.code);
    expect(item).toMatchObject({ name: "E2E test", price: "120", status: "active" });
    expect(item.draws.map((d) => d.label)).toEqual(["Single"]);
    expect(item.machineSteps[0].machineType.name).toBe((await baseline.machineType()).name);
  });

  test("pathologists can't approve catalog changes; the lead's own apply at once", async ({ api, users, leadApi }) => {
    const path = await api(users.path1);
    const { approvals } = await path.call("POST", "/catalog/changes", { changes: [{ action: "create", values: test_() }] });
    expect((await path.raw("POST", `/approvals/${approvals[0].id}/approve`, {})).status).toBe(403);

    const values = test_();
    const own = await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values }] });
    expect(own.approvals[0]).toMatchObject({ status: "approved", selfApproved: true });
    expect(await inCatalog(leadApi, values.code)).toBeDefined();
  });

  test("a grid batch is all-or-nothing, with an error per bad row", async ({ techApi }) => {
    const good = test_();
    const { status, body } = await techApi.raw("POST", "/catalog/changes", {
      changes: [
        { action: "create", values: good },
        { action: "create", values: test_({ code: "CBC" }) },
        { action: "create", values: test_({ name: "" }) },
        { action: "create", values: test_({ code: good.code }) },
      ],
    });
    expect(status).toBe(400);
    expect(body.rows.map((r) => r.row)).toEqual([1, 2, null]);
    expect(body.rows[0].error).toMatch(/already in use/);
    expect(await db().approval.count({ where: { payload: { path: ["values", "code"], equals: good.code } } })).toBe(0);
  });

  test("a profile is built from active tests; kinds keep to their own fields", async ({ leadApi }) => {
    const [chol, tg] = await Promise.all([baseline.item("CHOL"), baseline.item("TG")]);
    const profile = { code: code(), name: "E2E profile", kind: "profile", price: 200, components: [chol.id, tg.id] };
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: profile }] });
    expect((await inCatalog(leadApi, profile.code)).components.map((c) => c.test.code).sort()).toEqual(["CHOL", "TG"]);

    for (const [values, error] of [
      [{ ...profile, code: code(), components: [] }, /needs its tests/],
      [{ ...profile, code: code(), components: [(await baseline.item("LIPID")).id] }, /must be active tests/],
      [{ ...profile, code: code(), draws: ["Single"] }, /only a test has sample draws/],
      [test_({ components: [chol.id] }), /only a profile has component tests/],
      [test_({ draws: ["A", "A"] }), /distinct label/],
      [test_({ code: "HOMEVISIT" }), /isn't a valid code/],
    ]) {
      const { body } = await leadApi.raw("POST", "/catalog/changes", { changes: [{ action: "create", values }] });
      expect.soft(body.rows?.[0]?.error).toMatch(error);
    }
  });

  test("edits and retirement also go through approval; old bills keep their prices", async ({ techApi, leadApi }) => {
    const values = test_();
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values }] });
    const item = await inCatalog(leadApi, values.code);
    const bill = await techApi.createBill({ items: [values.code] });

    const edit = await techApi.call("POST", "/catalog/changes", {
      changes: [{ action: "update", catalogItemId: item.id, values: { ...values, price: 999 } }],
    });
    const duplicate = await techApi.raw("POST", "/catalog/changes", { changes: [{ action: "retire", catalogItemId: item.id }] });
    expect(duplicate.body.rows[0].error).toMatch(/already has a change waiting/);
    await leadApi.decide(edit.approvals[0].id, "approve");
    expect((await inCatalog(techApi, values.code)).price).toBe("999");
    expect((await techApi.getBill(bill.id)).items[0].price).toBe("120");

    const retire = await techApi.call("POST", "/catalog/changes", { changes: [{ action: "retire", catalogItemId: item.id }] });
    await leadApi.decide(retire.approvals[0].id, "approve");
    expect(await inCatalog(techApi, values.code)).toBeUndefined();
  });

  test("a test inside an active profile can't be retired", async ({ leadApi }) => {
    const chol = await baseline.item("CHOL");
    const { status, body } = await leadApi.raw("POST", "/catalog/changes", { changes: [{ action: "retire", catalogItemId: chol.id }] });
    expect(status).toBe(409);
    expect(body.error).toMatch(/part of profile LIPID/);
  });
});

test.describe("Referring doctors", () => {
  test("a new doctor is usable at once but holds the report until the lead approves", async ({ techApi, leadApi }) => {
    const { doctor } = await techApi.call("POST", "/doctors", { name: uid("Dr"), clinic: "E2E Clinic" });
    expect(doctor.status).toBe("pending");
    const bill = await techApi.createBill({ referralType: "doctor", referringDoctorId: doctor.id });
    expect(bill.holds).toEqual(["Referring doctor awaiting approval"]);

    const approval = await techApi.approvalFor({ subjectId: doctor.id, subjectType: "referring_doctor" });
    await leadApi.decide(approval.id, "approve");
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);
  });

  test("a rejected doctor is dropped from their bills, which records it", async ({ techApi, leadApi }) => {
    const { doctor } = await techApi.call("POST", "/doctors", { name: uid("Dr") });
    const bill = await techApi.createBill({ referralType: "doctor", referringDoctorId: doctor.id });
    const approval = await techApi.approvalFor({ subjectId: doctor.id, subjectType: "referring_doctor" });
    await leadApi.decide(approval.id, "reject", "Not a registered practitioner");

    const after = await techApi.getBill(bill.id);
    expect(after).toMatchObject({ referralType: "doctor", referringDoctor: null, holds: [] });
    expect(after.events.map((e) => e.kind)).toEqual(["doctor_dropped"]);
    const { doctors } = await techApi.call("GET", "/doctors");
    expect(doctors.map((d) => d.id)).not.toContain(doctor.id);
  });

  test("the lead's own doctor is approved at once", async ({ leadApi }) => {
    const { doctor } = await leadApi.call("POST", "/doctors", { name: uid("Dr") });
    expect(doctor.status).toBe("approved");
  });
});

test.describe("Most used items (the quick tiles)", () => {
  test("up to 18 of the most billed active items, in code order; retired items and home visits never", async ({ techApi, leadApi }) => {
    const busy = test_({ price: 10 });
    const retiring = test_({ price: 10 });
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: busy }, { action: "create", values: retiring }] });
    const [b, r] = [await inCatalog(leadApi, busy.code), await inCatalog(leadApi, retiring.code)];
    const patient = await techApi.registerPatient();
    for (let n = 0; n < 25; n++) {
      await techApi.createBill({ patientId: patient.id, items: [busy.code, retiring.code], collectionMode: n === 0 ? "home_visit" : undefined });
    }
    await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "retire", catalogItemId: r.id }] });

    const { items, days } = await techApi.call("GET", "/catalog/popular");
    expect(days).toBe(90);
    expect(items.length).toBeLessThanOrEqual(18);
    const codes = items.map((i) => i.code);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toContain(b.code);
    expect(codes).not.toContain(retiring.code);
    expect(codes).not.toContain("HOMEVISIT");
  });
});
