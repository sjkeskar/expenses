// pivot.md §4.3, §4.8: creating bills — lines and totals, home visits,
// per-test sample draws and revisits, preview warnings, report time.
const { test, expect } = require("../../fixtures");
const { baseline } = require("../../helpers/db");
const { ist, istDate } = require("../../helpers/data");

const ids = async (...codes) => Promise.all(codes.map(async (c) => (await baseline.item(c)).id));

test.describe("Creating a bill", () => {
  test("totals come from the lines; the technician never types an amount", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], discountAmount: 50, initialPayment: { amount: 100, mode: "upi" } });
    expect(bill.items.map((i) => [i.code, i.price])).toEqual([["CBC", "300"], ["GLUF", "100"]]);
    expect(bill).toMatchObject({ originalAmount: "400", discountAmount: "50", netAmount: "350", balance: "250", status: "pending" });
    expect(bill.transactions).toEqual([expect.objectContaining({ amountCollected: "100", mode: "upi" })]);
    expect(bill.verificationCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });

  test("a fully paid bill, and a 100% discount, are fully_paid", async ({ techApi }) => {
    expect((await techApi.createBill({ initialPayment: { amount: 300, mode: "cash" } })).status).toBe("fully_paid");
    expect((await techApi.createBill({ discountAmount: 300 })).status).toBe("fully_paid");
  });

  test("bad input is refused", async ({ techApi }) => {
    const patient = await techApi.registerPatient();
    const branch = await baseline.branch();
    const base = { patientId: patient.id, itemIds: await ids("CBC"), referralType: "walk_in", payerType: "self", locationId: branch.id };
    for (const [change, error] of [
      [{ patientId: undefined }, /registered patient/],
      [{ itemIds: [] }, /at least one/],
      [{ itemIds: [...(await ids("CBC")), ...(await ids("CBC"))] }, /only be added once/],
      [{ itemIds: ["00000000-0000-0000-0000-000000000000"] }, /active catalog/],
      [{ referralType: "friend" }, /referralType/],
      [{ payerType: "panel" }, /valid panel/],
      [{ panelId: (await baseline.panel()).id }, /Only a panel bill/],
      [{ discountAmount: 301 }, /can't exceed/],
      [{ initialPayment: { amount: 400, mode: "cash" } }, /beyond the bill's net amount/],
      [{ initialPayment: { amount: 10, mode: "cheque" } }, /mode must be/],
      [{ billDate: "2026-02-30" }, /billDate/],
    ]) {
      const { status, body } = await techApi.raw("POST", "/bills", { ...base, ...change });
      expect.soft(status, JSON.stringify(change)).toBe(400);
      expect.soft(body.error).toMatch(error);
    }
  });

  test("the patient's details are read live and their age is as of the bill date", async ({ techApi }) => {
    const patient = await techApi.registerPatient({ dateOfBirth: "2000-06-15" });
    const bill = await techApi.createBill({ patientId: patient.id, billDate: "2010-06-14" });
    expect(bill.patientAge).toBe(9);
    expect(bill.patient.patientNumber).toBe(patient.patientNumber);
  });

  test("a walk-in can't name a doctor; a doctor referral may name one or none", async ({ techApi }) => {
    const doctor = await baseline.doctor();
    const walkIn = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: await ids("CBC"), referralType: "walk_in", referringDoctorId: doctor.id,
      payerType: "self", locationId: (await baseline.branch()).id,
    });
    expect(walkIn.status).toBe(400);
    expect((await techApi.createBill({ referralType: "doctor", referringDoctorId: doctor.id })).referringDoctor.id).toBe(doctor.id);
    expect((await techApi.createBill({ referralType: "doctor" })).referringDoctor).toBeNull();
  });
});

test.describe("Home visits", () => {
  test("adds a home-visit line at the location's charge, which may be raised but not lowered", async ({ techApi }) => {
    const atMinimum = await techApi.createBill({ collectionMode: "home_visit", homeVisitAddress: "4 Visit Lane" });
    const line = atMinimum.items.find((i) => i.code === "HOMEVISIT");
    expect(line).toMatchObject({ kind: "service", price: "200" });
    expect(atMinimum).toMatchObject({ originalAmount: "500", homeVisitAddress: "4 Visit Lane" });

    const raised = await techApi.createBill({ collectionMode: "home_visit", homeVisitCharge: 350 });
    expect(raised.items.find((i) => i.code === "HOMEVISIT").price).toBe("350");
    expect(raised.homeVisitAddress).toBeNull(); // the address is optional

    const { status, body } = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: await ids("CBC"), referralType: "walk_in", payerType: "self",
      locationId: (await baseline.branch()).id, collectionMode: "home_visit", homeVisitCharge: 150,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/at least 200/);
  });

  test("a location with no home-visit charge doesn't offer home visits", async ({ techApi }) => {
    const { status, body } = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: await ids("CBC"), referralType: "walk_in", payerType: "self",
      locationId: (await baseline.noVisitBranch()).id, collectionMode: "home_visit",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/doesn't offer home visits/);
  });

  test("the home-visit item can't be billed directly or seen in the catalog", async ({ techApi }) => {
    await techApi.createBill({ collectionMode: "home_visit" }); // makes sure the item exists
    const { items } = await techApi.call("GET", "/catalog");
    expect(items.map((i) => i.code)).not.toContain("HOMEVISIT");
  });
});

test.describe("Sample draws and revisits", () => {
  test("every draw of every test is tracked; a profile's tests each get their own", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["GTT", "LIPID"] });
    const draws = (code) => bill.items.find((i) => i.code === code).collections.map((c) => c.label);
    expect(draws("GTT")).toEqual(["Fasting", "1 h", "2 h"]);
    expect(draws("LIPID")).toEqual(["Single", "Single"]);
    expect(bill.items.flatMap((i) => i.collections).every((c) => c.status === "collected")).toBe(true);
  });

  test("draws left for a revisit are pending until recorded; part of a profile can wait", async ({ techApi }) => {
    const [gtt, lipid, chol] = await ids("GTT", "LIPID", "CHOL");
    const dueAt = ist(istDate(), "11:00");
    const bill = await techApi.createBill({
      items: ["GTT", "LIPID"],
      pendingDraws: [
        { catalogItemId: gtt, testId: gtt, sequence: 2, dueAt },
        { catalogItemId: gtt, testId: gtt, sequence: 3, dueAt },
        { catalogItemId: lipid, testId: chol, sequence: 1, dueAt },
      ],
    });
    const pending = bill.items.flatMap((i) => i.collections).filter((c) => c.status === "pending");
    expect(pending).toHaveLength(3);

    const { collections } = await techApi.call("GET", `/bills/revisits?until=${istDate()}`);
    expect(collections.filter((c) => c.billItem.bill.id === bill.id)).toHaveLength(3);

    const after = (await techApi.call("PATCH", `/bills/${bill.id}/samples`, { collectionIds: pending.slice(0, 1).map((c) => c.id) })).bill;
    expect(after.items.flatMap((i) => i.collections).filter((c) => c.status === "pending")).toHaveLength(2);
    const again = await techApi.raw("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending[0].id] });
    expect(again.status).toBe(409);
  });

  test("a revisit needs a due time, and must name a draw that is on the bill", async ({ techApi }) => {
    const [cbc, gluf] = await ids("CBC", "GLUF");
    const base = {
      patientId: (await techApi.registerPatient()).id, itemIds: [cbc], referralType: "walk_in", payerType: "self",
      locationId: (await baseline.branch()).id,
    };
    const noTime = await techApi.raw("POST", "/bills", { ...base, pendingDraws: [{ catalogItemId: cbc, testId: cbc, sequence: 1 }] });
    expect(noTime.body.error).toMatch(/due date-time/);
    const naive = await techApi.raw("POST", "/bills", { ...base, pendingDraws: [{ catalogItemId: cbc, testId: cbc, sequence: 1, dueAt: "2026-10-27T09:00:00" }] });
    expect(naive.body.error).toMatch(/timezone offset/);
    const elsewhere = await techApi.raw("POST", "/bills", {
      ...base, pendingDraws: [{ catalogItemId: gluf, testId: gluf, sequence: 1, dueAt: ist(istDate()) }],
    });
    expect(elsewhere.body.error).toMatch(/aren't on this bill/);
  });
});

test.describe("Preview and report time", () => {
  test("preview prices the lines and warns about a test billed twice", async ({ techApi }) => {
    const preview = await techApi.call("POST", "/bills/preview", {
      itemIds: await ids("LIPID", "CHOL"), referralType: "walk_in", payerType: "self", locationId: (await baseline.branch()).id, discountAmount: 20,
    });
    expect(preview).toMatchObject({ originalAmount: "400.00", netAmount: "380.00" });
    expect(preview.warnings).toEqual(["CHOL is billed twice: in LIPID and CHOL."]);
  });

  test("the expected report time is set by hand and can be changed or cleared", async ({ techApi }) => {
    const bill = await techApi.createBill({ expectedReportAt: ist("2026-11-02", "18:00") });
    expect(new Date(bill.expectedReportAt).toISOString()).toBe("2026-11-02T12:30:00.000Z");
    const moved = (await techApi.call("PATCH", `/bills/${bill.id}/expected-report`, { expectedReportAt: ist("2026-11-03", "10:00") })).bill;
    expect(new Date(moved.expectedReportAt).toISOString()).toBe("2026-11-03T04:30:00.000Z");
    const cleared = (await techApi.call("PATCH", `/bills/${bill.id}/expected-report`, { expectedReportAt: null })).bill;
    expect(cleared.expectedReportAt).toBeNull();
  });
});
