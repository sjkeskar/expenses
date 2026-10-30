// Accounts (only the lead manages them), lab settings and locations
// (pivot.md §3.2–3.4, §4.3), and signing in.
const { test, expect } = require("../../fixtures");
const { ApiClient } = require("../../helpers/api");
const { createUser, db, baseline } = require("../../helpers/db");
const { uid } = require("../../helpers/data");
const { PASSWORD, BASELINE } = require("../../helpers/seed");

test.describe("Signing in", () => {
  test("wrong password, unknown user and deactivated user all get the same generic error", async ({ users }) => {
    const gone = await createUser("technician");
    await db().user.update({ where: { id: gone.id }, data: { isDeleted: true } });
    const anon = await ApiClient.create();
    try {
      for (const [name, password] of [[users.tech1.name, "Wrong@123"], [uid("nobody"), PASSWORD], [gone.name, PASSWORD]]) {
        const { status, body } = await anon.raw("POST", "/auth/login", { name, password });
        expect.soft(status).toBe(401);
        expect.soft(body.error).toBe("Invalid name or password.");
      }
    } finally {
      await anon.dispose();
    }
  });

  test("signing in records lastLoginAt", async () => {
    const user = await createUser("technician");
    const client = await ApiClient.as(user);
    await client.dispose();
    expect((await db().user.findUnique({ where: { id: user.id } })).lastLoginAt).not.toBeNull();
  });

  test("changing your own password enforces the policy and ends the session", async () => {
    const user = await createUser("technician");
    const client = await ApiClient.as(user);
    try {
      for (const bad of ["Ab@1", "Abcdef@", "Abcdef1"]) {
        const { status } = await client.raw("PATCH", "/auth/password", { currentPassword: user.password, newPassword: bad });
        expect.soft(status, bad).toBe(400);
      }
      // 400, not 401: the session is still valid (a 401 would sign the app out).
      expect((await client.raw("PATCH", "/auth/password", { currentPassword: "Wrong@1", newPassword: "Good@123" })).status).toBe(400);
      await client.call("PATCH", "/auth/password", { currentPassword: user.password, newPassword: "Good@123" });
      expect((await client.raw("GET", "/auth/me")).status).toBe(401);
    } finally {
      await client.dispose();
    }
  });
});

test.describe("Accounts (lead only)", () => {
  test("the lead creates pathologist, technician and accountant accounts; names are trimmed", async ({ leadApi }) => {
    for (const role of ["pathologist", "technician", "accountant"]) {
      const name = uid(role);
      const { user } = await leadApi.call("POST", "/users", { name: `  ${name} `, password: "Good@123", role });
      expect(user).toMatchObject({ name, role });
    }
  });

  test("no one else can be created here, and names are unique", async ({ leadApi, users }) => {
    for (const role of ["developer", "lead_pathologist", "admin"]) {
      const { status } = await leadApi.raw("POST", "/users", { name: uid(role), password: "Good@123", role });
      expect.soft(status, role).toBe(400);
    }
    const dup = await leadApi.raw("POST", "/users", { name: users.tech1.name, password: "Good@123", role: "technician" });
    expect(dup.status).toBe(409);
    const weak = await leadApi.raw("POST", "/users", { name: uid("weak"), password: "short", role: "technician" });
    expect(weak.status).toBe(400);
  });

  test("the lead resets a password: the old one stops working, the new one works", async ({ leadApi }) => {
    const user = await createUser("technician");
    await leadApi.call("PATCH", `/users/${user.id}/password`, { newPassword: "Reset@99" });
    const anon = await ApiClient.create();
    try {
      expect((await anon.raw("POST", "/auth/login", { name: user.name, password: user.password })).status).toBe(401);
      expect((await anon.raw("POST", "/auth/login", { name: user.name, password: "Reset@99" })).status).toBe(200);
    } finally {
      await anon.dispose();
    }
  });

  test("a deactivated user's live session stops working at once", async ({ leadApi }) => {
    const user = await createUser("technician");
    const client = await ApiClient.as(user);
    try {
      await leadApi.call("DELETE", `/users/${user.id}`);
      expect((await client.raw("GET", "/bills")).status).toBe(401);
      expect((await client.raw("PATCH", "/auth/password", { currentPassword: user.password, newPassword: "Good@123" })).status).toBe(401);
    } finally {
      await client.dispose();
    }
  });

  test("the lead's own and developer accounts aren't managed here", async ({ leadApi }) => {
    const [lead, dev] = await Promise.all(["e2e-lead", "e2e-dev"].map((name) => db().user.findUnique({ where: { name } })));
    for (const target of [lead, dev]) {
      expect.soft((await leadApi.raw("DELETE", `/users/${target.id}`)).status).toBe(400);
      expect.soft((await leadApi.raw("PATCH", `/users/${target.id}/password`, { newPassword: "Good@123" })).status).toBe(400);
    }
  });
});

test.describe("Lab settings", () => {
  test("everyone reads them; the lead edits them; a second setup is refused", async ({ techApi, leadApi, api, users }) => {
    expect((await techApi.call("GET", "/settings")).settings).toMatchObject({ labName: "E2E Diagnostics" });
    const { settings } = await leadApi.call("PATCH", "/settings", { labName: "E2E Diagnostics", phone: "0200000001", address: "1 Lab Road" });
    expect(settings.phone).toBe("0200000001");
    expect((await leadApi.raw("PATCH", "/settings", { labName: "" })).status).toBe(400);
    await leadApi.call("PATCH", "/settings", BASELINE.settings);

    const dev = await api(users.dev);
    const { status, body } = await dev.raw("POST", "/settings/setup", {
      labName: "Another lab", phone: "1", address: "x", lead: { name: uid("lead"), password: "Good@123" },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already set up/);
  });
});

test.describe("Locations", () => {
  test("codes are unique; a centre needs an active processing branch", async ({ leadApi }) => {
    const branch = await leadApi.addLocation();
    const dup = await leadApi.raw("POST", "/locations", { name: uid("Loc"), type: "branch", address: "x", locationCode: branch.locationCode });
    expect(dup.status).toBe(409);

    const orphan = await leadApi.raw("POST", "/locations", { name: uid("Ctr"), type: "collection_centre", address: "x", locationCode: "00" });
    expect(orphan.body.error).toMatch(/processes its samples/);
    const centre = await leadApi.addLocation({ type: "collection_centre", processingBranchId: branch.id });
    expect(centre.processingBranch.id).toBe(branch.id);
    const viaCentre = await leadApi.raw("POST", "/locations", {
      name: uid("Ctr"), type: "collection_centre", address: "x", locationCode: "00", processingBranchId: centre.id,
    });
    expect(viaCentre.status).toBe(400);

    const busy = await leadApi.raw("DELETE", `/locations/${branch.id}`);
    expect(busy.status).toBe(409);
    await leadApi.call("DELETE", `/locations/${centre.id}`);
    await leadApi.call("DELETE", `/locations/${branch.id}`);
  });

  test("editing can set or clear the home-visit charge, but never the code", async ({ leadApi, techApi }) => {
    const loc = await leadApi.addLocation({ homeVisitCharge: 100 });
    const { location } = await leadApi.call("PATCH", `/locations/${loc.id}`, { homeVisitCharge: null, locationCode: "00", address: "New address" });
    expect(location).toMatchObject({ homeVisitCharge: null, locationCode: loc.locationCode, address: "New address" });
    const { status } = await techApi.raw("POST", "/bills", {
      patientId: (await techApi.registerPatient()).id, itemIds: [(await baseline.item("CBC")).id], referralType: "walk_in",
      payerType: "self", locationId: loc.id, collectionMode: "home_visit",
    });
    expect(status).toBe(400);
  });

  test("a branch becomes a collection centre once it has no machines; its samples go to another branch", async ({ leadApi, techApi }) => {
    const [branch, processor] = [await leadApi.addLocation(), await leadApi.addLocation()];
    const bill = await techApi.createBill({ locationId: branch.id });
    const { machine } = await leadApi.call("POST", "/machines", { name: uid("Unit"), machineTypeId: (await baseline.machineType()).id, branchId: branch.id });
    const toCentre = { type: "collection_centre", processingBranchId: processor.id };

    let res = await leadApi.raw("PATCH", `/locations/${branch.id}`, toCentre);
    expect([res.status, res.body.error]).toEqual([409, `${branch.name} still has machines (${machine.name}). Remove or move them first.`]);
    await leadApi.call("DELETE", `/machines/${machine.id}`);

    res = await leadApi.raw("PATCH", `/locations/${branch.id}`, { type: "collection_centre" });
    expect(res.body.error).toMatch(/needs the active branch that processes its samples/);
    res = await leadApi.raw("PATCH", `/locations/${branch.id}`, { type: "collection_centre", processingBranchId: branch.id });
    expect(res.status).toBe(400); // not processed by itself

    const { location } = await leadApi.call("PATCH", `/locations/${branch.id}`, { ...toCentre, locationCode: "00" });
    expect(location).toMatchObject({ type: "collection_centre", locationCode: branch.locationCode, processingBranch: { id: processor.id } });
    // Old bills are untouched; new ones still number under the same code.
    expect((await techApi.getBill(bill.id)).billNumber).toBe(bill.billNumber);
    expect((await techApi.createBill({ locationId: branch.id })).billNumber.slice(0, 2)).toBe(branch.locationCode);

    // And back: a branch again, processing its own samples.
    const { location: back } = await leadApi.call("PATCH", `/locations/${branch.id}`, { type: "branch" });
    expect(back).toMatchObject({ type: "branch", processingBranchId: null });
  });

  test("a branch that processes a centre's samples stays a branch until they go elsewhere", async ({ leadApi }) => {
    const [branch, other] = [await leadApi.addLocation(), await leadApi.addLocation()];
    const centre = await leadApi.addLocation({ type: "collection_centre", processingBranchId: branch.id });
    const res = await leadApi.raw("PATCH", `/locations/${branch.id}`, { type: "collection_centre", processingBranchId: other.id });
    expect([res.status, res.body.error]).toEqual([409, `${branch.name} still processes samples for ${centre.name}. Send their samples to another branch first.`]);

    await leadApi.call("PATCH", `/locations/${centre.id}`, { processingBranchId: other.id });
    expect((await leadApi.raw("PATCH", `/locations/${branch.id}`, { type: "collection_centre", processingBranchId: other.id })).status).toBe(200);
  });

  test("only the lead changes a location's type", async ({ techApi, leadApi }) => {
    const [branch, other] = [await leadApi.addLocation(), await leadApi.addLocation()];
    expect((await techApi.raw("PATCH", `/locations/${branch.id}`, { type: "collection_centre", processingBranchId: other.id })).status).toBe(403);
  });
});
