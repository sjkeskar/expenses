// pivot.md §4.4: derived patient numbers, no duplicates, the look-alike
// warning, and corrections that apply only once approved.
const { test, expect } = require("../../fixtures");
const { db, createUser } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { uid, phone } = require("../../helpers/data");
const { identityKey, isValidPatientNumber } = require("../../../src/utils/patientNumber");

const details = (overrides = {}) => ({ name: uid("Pat"), sex: "male", dateOfBirth: "1990-05-17", phone: phone(), ...overrides });

test.describe("Registration and patient numbers", () => {
  test("a patient gets a 13-digit, check-digit-valid number with no letters", async ({ techApi }) => {
    const patient = await techApi.registerPatient(details());
    expect(patient.patientNumber).toMatch(/^\d{13}$/);
    expect(isValidPatientNumber(patient.patientNumber)).toBe(true);
    expect(patient.age).toBeGreaterThanOrEqual(35);
  });

  test("the same details give the same patient back — duplicates can't be entered", async ({ techApi, api, users }) => {
    const d = details();
    const first = await techApi.call("POST", "/patients", d);
    expect(first.existed).toBe(false);
    // Different case, spacing, punctuation and phone format still mean the same person.
    const again = await (await api(users.path1)).call("POST", "/patients", {
      ...d,
      name: `  ${d.name.toLowerCase()}. `,
      phone: `+91 ${d.phone.slice(0, 5)}-${d.phone.slice(5)}`,
    });
    expect(again.existed).toBe(true);
    expect(again.patient.id).toBe(first.patient.id);
    expect(again.patient.patientNumber).toBe(first.patient.patientNumber);
  });

  test("two technicians registering the same person at once get one record", async () => {
    const techs = await Promise.all(Array.from({ length: 4 }, () => createUser("technician").then((u) => ApiClient.as(u))));
    try {
      const d = details();
      const results = await Promise.all(techs.map((t) => t.call("POST", "/patients", d)));
      expect(new Set(results.map((r) => r.patient.id)).size).toBe(1);
      expect(results.filter((r) => !r.existed)).toHaveLength(1);
    } finally {
      await Promise.all(techs.map((t) => t.dispose()));
    }
  });

  test("an age is stored as an approximate DOB and shown back as that age", async ({ techApi }) => {
    const patient = await techApi.registerPatient({ ageYears: 42 });
    expect(patient.dobIsApproximate).toBe(true);
    expect(patient.age).toBe(42);
  });

  test("required fields are validated", async ({ techApi }) => {
    for (const [body, error] of [
      [details({ name: "  " }), /name is required/],
      [details({ sex: "x" }), /sex must be/],
      [details({ phone: "12345" }), /10-digit/],
      [{ ...details(), dateOfBirth: undefined }, /date of birth or an age/],
      [details({ dateOfBirth: "2999-01-01" }), /past date/],
    ]) {
      const { status, body: res } = await techApi.raw("POST", "/patients", body);
      expect.soft(status).toBe(400);
      expect.soft(res.error).toMatch(error);
    }
  });

  test("a probable look-alike (same phone, sex, birth year ±1) is flagged until confirmed distinct", async ({ techApi }) => {
    const d = details({ name: uid("Mohammed") });
    const original = await techApi.registerPatient(d);
    const variant = { ...d, name: d.name.replace("Mohammed", "Mohd"), dateOfBirth: "1991-02-01" };

    const { status, body } = await techApi.raw("POST", "/patients", variant);
    expect(status).toBe(409);
    expect(body.lookalikes.map((p) => p.id)).toContain(original.id);

    const confirmed = await techApi.call("POST", "/patients", { ...variant, confirmedDistinct: true });
    expect(confirmed.patient.id).not.toBe(original.id);
    // A family member sharing the phone but of another sex isn't flagged.
    const spouse = await techApi.raw("POST", "/patients", { ...d, name: uid("Spouse"), sex: "female" });
    expect(spouse.status).toBe(201);
  });

  test("a number clash between different people falls back to the next free number", async ({ techApi }) => {
    const d = details();
    const a = await techApi.registerPatient(d);
    // Make A someone else (another identity) while keeping their number, so
    // the same details now derive a number held by a different patient.
    await db().patient.update({ where: { id: a.id }, data: { identityKey: `${identityKey({ ...d, dobIsApproximate: false })}#other` } });
    const b = await techApi.registerPatient({ ...d, confirmedDistinct: true });
    expect(b.id).not.toBe(a.id);
    expect(b.patientNumber).not.toBe(a.patientNumber);
    expect(isValidPatientNumber(b.patientNumber)).toBe(true);
  });

  test("search finds patients by number, phone digits or name", async ({ techApi }) => {
    const patient = await techApi.registerPatient(details());
    for (const q of [patient.patientNumber, patient.phone.slice(-6), patient.name.slice(4, 14)]) {
      const { patients } = await techApi.call("GET", `/patients?q=${encodeURIComponent(q)}`);
      expect.soft(patients.map((p) => p.id), q).toContain(patient.id);
    }
  });
});

test.describe("Corrections", () => {
  test("a technician's correction changes nothing until a pathologist approves it", async ({ techApi, api, users }) => {
    const patient = await techApi.registerPatient(details());
    const bill = await techApi.createBill({ patientId: patient.id });
    const { approval } = await techApi.call("POST", `/patients/${patient.id}/corrections`, { name: `${patient.name} Kumar` });
    expect(approval.status).toBe("pending");
    expect((await techApi.call("GET", `/patients/${patient.id}`)).patient.name).toBe(patient.name);

    // One pending correction per patient at a time.
    const second = await techApi.raw("POST", `/patients/${patient.id}/corrections`, { sex: "female" });
    expect(second.status).toBe(409);

    await (await api(users.path1)).decide(approval.id, "approve");
    const after = (await techApi.call("GET", `/patients/${patient.id}`)).patient;
    expect(after.name).toBe(`${patient.name} Kumar`);
    expect(after.patientNumber).not.toBe(patient.patientNumber);
    expect(after.aliases.map((a) => a.number)).toEqual([patient.patientNumber]);
    const path1 = await db().user.findUnique({ where: { name: users.path1.name } });
    expect(after.changes).toEqual([expect.objectContaining({ field: "name", oldValue: patient.name, approvedById: path1.id })]);

    // The old printout's number still finds them; the old bill shows the new details.
    const { patients } = await techApi.call("GET", `/patients?q=${patient.patientNumber}`);
    expect(patients.map((p) => p.id)).toEqual([patient.id]);
    expect((await techApi.getBill(bill.id)).patient.name).toBe(`${patient.name} Kumar`);
  });

  test("a rejected correction leaves the patient untouched", async ({ techApi, api, users }) => {
    const patient = await techApi.registerPatient(details());
    const { approval } = await techApi.call("POST", `/patients/${patient.id}/corrections`, { phone: phone() });
    await (await api(users.path1)).decide(approval.id, "reject", "Phone was right");
    const after = (await techApi.call("GET", `/patients/${patient.id}`)).patient;
    expect(after.phone).toBe(patient.phone);
    expect(after.patientNumber).toBe(patient.patientNumber);
  });

  test("a pathologist's own correction applies at once", async ({ api, users }) => {
    const path = await api(users.path1);
    const patient = await path.registerPatient(details());
    const { approval } = await path.call("POST", `/patients/${patient.id}/corrections`, { dateOfBirth: "1989-01-02" });
    expect(approval).toMatchObject({ status: "approved", selfApproved: true });
    const after = (await path.call("GET", `/patients/${patient.id}`)).patient;
    expect(after.dateOfBirth.slice(0, 10)).toBe("1989-01-02");
    expect(after.patientNumber).not.toBe(patient.patientNumber);
  });

  test("a correction making the patient identical to another is refused, when proposed and when approved", async ({ techApi, api, users }) => {
    const a = await techApi.registerPatient(details());
    const b = await techApi.registerPatient(details());
    const proposed = await techApi.raw("POST", `/patients/${b.id}/corrections`, { name: a.name, phone: a.phone });
    expect(proposed.status).toBe(409);
    expect(proposed.body.patient.id).toBe(a.id);

    // Proposed while unique, but someone with those details registers before approval.
    const target = details();
    const { approval } = await techApi.call("POST", `/patients/${b.id}/corrections`, { name: target.name, phone: target.phone });
    await techApi.registerPatient({ ...target, dateOfBirth: "1990-05-17" });
    const { status } = await (await api(users.path1)).raw("POST", `/approvals/${approval.id}/approve`, {});
    expect(status).toBe(409);
  });

  test("correcting a phone keeps an age-entered patient's DOB approximate", async ({ api, users }) => {
    const path = await api(users.path1);
    const patient = await path.registerPatient({ ageYears: 50 });
    await path.call("POST", `/patients/${patient.id}/corrections`, { phone: phone() });
    const after = (await path.call("GET", `/patients/${patient.id}`)).patient;
    expect(after.dobIsApproximate).toBe(true);
    expect(after.age).toBe(50);
  });
});
