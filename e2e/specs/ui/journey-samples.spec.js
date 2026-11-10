// Sample collection through the screens. Every sample is "Collected now"
// when the bill is created, stamped with the bill's time, unless the
// technician switches it off and says when the patient is due back; those
// are recorded later, from the bill or from the revisit list.
const { test, expect } = require("../../fixtures");
const { baseline, db } = require("../../helpers/db");
const { istDate } = require("../../helpers/data");
const { BASELINE } = require("../../helpers/seed");
const { chooseOption, addItem } = require("../../helpers/ui");
const { billHeading, createBill, section, pickerTime, dmy, fillPicker } = require("../../helpers/flows");

const STAMP = /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM)/;
const hours = (n) => new Date(Date.now() + n * 3600e3).toISOString();
const samples = (page) => section(page, "Samples");
const sampleRow = (page, name) => samples(page).getByRole("row", { name });

// A GTT bill with the given draws (by sequence: 1 Fasting, 2 "1 h", 3 "2 h") left for a revisit.
async function gttBill(api, due, opts = {}) {
  const gtt = await baseline.item("GTT");
  const pendingDraws = Object.entries(due).map(([sequence, dueAt]) => ({ catalogItemId: gtt.id, testId: gtt.id, sequence: Number(sequence), dueAt }));
  return api.createBill({ items: ["GTT"], pendingDraws, ...opts });
}

// Ticks the given samples on a bill page and confirms Record collection.
async function recordCollection(page, labels) {
  for (const label of labels) await page.getByLabel(`Select ${label}`).check();
  await page.getByRole("button", { name: "Record collection" }).click();
  await page.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
}

test.describe("At billing", () => {
  test("every sample is collected as the bill is created, stamped with the time and the technician", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await addItem(tech, "GTT");
    // One row per draw, each on "Collected now".
    for (const draw of ["CBC Single", "GTT Fasting", "GTT 1 h", "GTT 2 h"]) {
      await expect(tech.getByLabel(`${draw} collected now`)).toBeChecked();
    }
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();

    const today = dmy(istDate());
    for (const name of [/CBC · Complete blood count Single/, /GTT · Glucose tolerance Fasting/, /GTT · Glucose tolerance 1 h/, /GTT · Glucose tolerance 2 h/]) {
      const row = sampleRow(tech, name);
      await expect(row).toContainText("Collected");
      await expect(row).toContainText(STAMP);
      await expect(row).toContainText(today);
      await expect(row.getByRole("checkbox")).toBeDisabled(); // nothing left to record
    }
    await expect(tech.getByRole("button", { name: "Record collection" })).toBeDisabled();
    const me = await db().user.findUnique({ where: { name: users.tech1.name } });
    const rows = await db().sampleCollection.findMany({ where: { billItem: { bill: { patientId: patient.id } } } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "collected" && r.collectedById === me.id && r.collectedAt)).toBe(true);
  });

  test("switching a sample off and on again leaves it collected now, with no due time asked for", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    const now = tech.getByLabel("CBC Single collected now");
    await now.click();
    await expect(tech.getByLabel("CBC Single due back")).toBeVisible();
    await now.click();
    await expect(tech.getByLabel("CBC Single due back")).toHaveCount(0);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(sampleRow(tech, /CBC · Complete blood count Single/)).toContainText("Collected");
  });

  test("a home visit entered before the visit: every sample is left pending, then recorded when the samples arrive", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await tech.getByLabel("Home visit").check();
    await addItem(tech, "CBC");
    await addItem(tech, "GLUF");
    const visit = pickerTime(3);
    for (const draw of ["CBC Single", "GLUF Single"]) {
      await tech.getByLabel(`${draw} collected now`).click();
      await fillPicker(tech.getByLabel(`${draw} due back`), visit);
    }
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    await expect(tech.getByRole("main")).toContainText("Home visit");
    // The home-visit line itself has no sample.
    await expect(samples(tech).getByRole("row", { name: /HOMEVISIT|Home visit/ })).toHaveCount(0);
    for (const name of [/CBC · Complete blood count Single/, /GLUF · Glucose fasting Single/]) {
      await expect(sampleRow(tech, name)).toContainText("Pending");
      await expect(sampleRow(tech, name)).toContainText(visit);
    }

    await recordCollection(tech, ["CBC Single", "GLUF Single"]);
    await expect(tech.getByText("The samples are recorded as collected.")).toBeVisible();
    for (const name of [/CBC · Complete blood count Single/, /GLUF · Glucose fasting Single/]) {
      await expect(sampleRow(tech, name)).toContainText("Collected");
    }
  });

  test("a bill entered for yesterday stamps its samples with yesterday's date", async ({ loginAs, users, techApi }) => {
    const patient = await techApi.registerPatient();
    const yesterday = dmy(istDate(new Date(Date.now() - 24 * 3600e3)));
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/new?patient=${patient.id}`);
    await chooseOption(tech, "Branch or centre", BASELINE.branch.name);
    await addItem(tech, "CBC");
    await fillPicker(tech.getByLabel("Bill date"), yesterday);
    await createBill(tech);
    await expect(billHeading(tech)).toBeVisible();
    const row = sampleRow(tech, /CBC · Complete blood count Single/);
    await expect(row).toContainText("Collected");
    await expect(row).toContainText(yesterday);
  });
});

test.describe("Recording a collection on the bill", () => {
  test("several pending samples are ticked and recorded together; the rest stay pending", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 1: hours(1), 2: hours(2), 3: hours(3) });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByLabel("Select GTT Fasting").check();
    await tech.getByLabel("Select GTT 1 h").check();
    await tech.getByRole("button", { name: "Record collection" }).click();
    await expect(tech.getByRole("tooltip")).toContainText("Mark 2 samples collected?");
    await expect(tech.getByRole("tooltip")).toContainText("Recorded as collected by you.");
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(sampleRow(tech, /Glucose tolerance Fasting/)).toContainText("Collected");
    await expect(sampleRow(tech, /Glucose tolerance 1 h/)).toContainText("Collected");
    await expect(sampleRow(tech, /Glucose tolerance 1 h/)).toContainText(dmy(istDate()));
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Pending");
    await expect(tech.getByLabel("Select GTT 1 h")).toBeDisabled();
    await expect(tech.getByLabel("Select GTT 2 h")).toBeEnabled();
    expect(await db().sampleCollection.count({ where: { billItem: { billId: bill.id }, status: "pending" } })).toBe(1);
  });

  test("nothing ticked, nothing to record; backing out of the confirmation records nothing", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(2) });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    const record = tech.getByRole("button", { name: "Record collection" });
    await expect(record).toBeDisabled();
    await tech.getByLabel("Select GTT 2 h").check();
    await expect(record).toBeEnabled();
    await record.click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Cancel" }).click();
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Pending");
    await tech.getByLabel("Select GTT 2 h").uncheck();
    await expect(record).toBeDisabled();
    expect(await db().sampleCollection.count({ where: { billItem: { billId: bill.id }, status: "pending" } })).toBe(1);
  });

  test("a sample collected at another desk meanwhile: the technician is told, and nothing is recorded twice", async ({ loginAs, users, techApi, api }) => {
    const bill = await gttBill(techApi, { 3: hours(1) });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByLabel("Select GTT 2 h").check();

    const pending = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, status: "pending" } });
    await (await api(users.tech2)).call("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending.id] });
    const first = await db().sampleCollection.findUnique({ where: { id: pending.id } });

    await tech.getByRole("button", { name: "Record collection" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(tech.getByText("Some of those samples are already collected.")).toBeVisible();
    // The first collection stands: its time and its collector aren't overwritten.
    const after = await db().sampleCollection.findUnique({ where: { id: pending.id } });
    expect(after.collectedAt).toEqual(first.collectedAt);
    expect(after.collectedById).toBe(first.collectedById);
    await tech.reload();
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Collected");
  });

  test("a cancelled test's samples read Cancelled and can't be recorded", async ({ loginAs, users, techApi }) => {
    const gtt = await baseline.item("GTT");
    const bill = await techApi.createBill({
      items: ["CBC", "GTT"],
      pendingDraws: [{ catalogItemId: gtt.id, testId: gtt.id, sequence: 3, dueAt: hours(-1) }],
    });
    const tech = await loginAs(users.tech1);
    await tech.goto("/revisits");
    await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();

    await tech.goto(`/bills/${bill.id}`);
    await tech.getByRole("button", { name: "Cancel tests" }).click();
    const dialog = tech.getByRole("dialog", { name: "Cancel tests" });
    await dialog.getByLabel(/^GTT/).check();
    await dialog.getByLabel("Reason").fill("Patient can't wait two hours");
    await dialog.getByRole("button", { name: "Cancel tests" }).click();
    await expect(dialog).toBeHidden();
    for (const name of [/Glucose tolerance Fasting/, /Glucose tolerance 1 h/, /Glucose tolerance 2 h/]) {
      await expect(sampleRow(tech, name)).toContainText("Cancelled");
      await expect(sampleRow(tech, name).getByRole("checkbox")).toBeDisabled();
    }
    await expect(sampleRow(tech, /CBC · Complete blood count Single/)).toContainText("Collected");
    // The patient is no longer expected back.
    await tech.goto("/revisits");
    await tech.locator(".ant-segmented").getByText("All pending", { exact: true }).click();
    await expect(tech.getByRole("heading", { name: "Sample revisits" })).toBeVisible();
    await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toHaveCount(0);
  });

  test("a fully cancelled bill has no sample left to record", async ({ loginAs, users, techApi }) => {
    const created = await gttBill(techApi, { 2: hours(1), 3: hours(2) });
    await techApi.cancel(created, ["GTT"]);
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${created.id}`);
    await expect(tech.getByRole("main")).toContainText("StatusCancelled");
    for (const label of ["GTT Fasting", "GTT 1 h", "GTT 2 h"]) await expect(tech.getByLabel(`Select ${label}`)).toBeDisabled();
    await expect(tech.getByRole("button", { name: "Record collection" })).toBeDisabled();
  });

  test("the bill's print lists the samples still to give, and drops the list once all are in", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(2) });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/print/bill/${bill.id}`);
    const sheet = tech.getByRole("main", { name: `Bill ${bill.billNumber}` });
    await expect(sheet).toContainText("Samples still to give");
    await expect(sheet).toContainText("Glucose tolerance (2 h)");
    await expect(sheet).not.toContainText("Glucose tolerance (1 h)"); // already collected

    await tech.goto(`/bills/${bill.id}`);
    await recordCollection(tech, ["GTT 2 h"]);
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Collected");
    await tech.goto(`/print/bill/${bill.id}`);
    await expect(sheet).toContainText(bill.billNumber);
    await expect(sheet).not.toContainText("Samples still to give");
  });

  test("an accountant sees the samples and their times, but can't record a collection", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(2) });
    const acct = await loginAs(users.acct);
    await acct.goto(`/bills/${bill.id}`);
    await expect(sampleRow(acct, /Glucose tolerance 2 h/)).toContainText("Pending");
    await expect(sampleRow(acct, /Glucose tolerance Fasting/)).toContainText(STAMP);
    await expect(acct.getByRole("button", { name: "Record collection" })).toHaveCount(0);
    await expect(samples(acct).getByRole("checkbox")).toHaveCount(0);
  });

  test("a collection time recorded by the server is shown as given (the time the sample was really taken)", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(-5) });
    const pending = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, status: "pending" } });
    const taken = new Date(Date.now() - 3 * 3600e3);
    await techApi.call("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending.id], collectedAt: taken.toISOString() });
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText(pickerTime(0, taken));
  });

  // Asked for by the lab (BUG-023): a home visit is often entered after the
  // samples were taken, so the confirmation takes the real time.
  test("recording a collection on the bill takes the time the sample was actually taken", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 2: hours(-6), 3: hours(-5) });
    const taken = pickerTime(-3);
    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByLabel("Select GTT 1 h").check();
    await tech.getByRole("button", { name: "Record collection" }).click();
    const confirm = tech.getByRole("tooltip");
    await expect(confirm.getByLabel("Collected at")).toHaveValue(""); // empty means now
    await fillPicker(confirm.getByLabel("Collected at"), taken);
    await confirm.getByRole("button", { name: "Mark collected" }).click();
    await expect(sampleRow(tech, /Glucose tolerance 1 h/)).toContainText("Collected");
    await expect(sampleRow(tech, /Glucose tolerance 1 h/)).toContainText(taken);

    // The time typed for one collection isn't carried into the next.
    await tech.getByLabel("Select GTT 2 h").check();
    await tech.getByRole("button", { name: "Record collection" }).click();
    await expect(tech.getByRole("tooltip").getByLabel("Collected at")).toHaveValue("");
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Collected");
    const last = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, sequence: 3 } });
    expect(Math.abs(last.collectedAt.getTime() - Date.now())).toBeLessThan(60e3);
  });

  test("the revisit list's confirmation takes the real collection time too", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(-5) });
    const taken = pickerTime(-2);
    const tech = await loginAs(users.tech1);
    await tech.goto("/revisits");
    const row = tech.getByRole("row", { name: new RegExp(bill.billNumber) });
    await row.getByRole("button", { name: "Mark collected" }).click();
    const confirm = tech.getByRole("tooltip");
    await expect(confirm).toContainText(`From ${bill.patient.name}, recorded by you.`);
    await fillPicker(confirm.getByLabel("Collected at"), taken);
    await confirm.getByRole("button", { name: "Mark collected" }).click();
    await expect(row).toBeHidden();
    await tech.goto(`/bills/${bill.id}`);
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText(taken);
  });

  test("a collection time in the future is refused, and the sample stays pending", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(-1) });
    const pending = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, status: "pending" } });
    const refused = await techApi.raw("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending.id], collectedAt: hours(2) });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("A sample can't be collected in the future.");

    const tech = await loginAs(users.tech1);
    await tech.goto(`/bills/${bill.id}`);
    await tech.getByLabel("Select GTT 2 h").check();
    await tech.getByRole("button", { name: "Record collection" }).click();
    const field = tech.getByRole("tooltip").getByLabel("Collected at");
    // Tomorrow can't be picked at all: typing it leaves the field as it was.
    await fillPicker(field, pickerTime(48));
    await expect(field).toHaveValue("");
    await tech.keyboard.press("Escape");
    await expect(sampleRow(tech, /Glucose tolerance 2 h/)).toContainText("Pending");
  });
});

test.describe("The revisit list", () => {
  test("due later today, due tomorrow and overdue: each is marked, and 'Due by today' leaves tomorrow's out", async ({ loginAs, users, techApi }) => {
    const endOfToday = `${istDate()}T23:59:00+05:30`;
    const [overdue, today, later] = [
      await gttBill(techApi, { 3: hours(-2) }),
      await gttBill(techApi, { 3: endOfToday }),
      await gttBill(techApi, { 3: hours(48) }),
    ];
    const tech = await loginAs(users.tech1);
    await tech.getByRole("menuitem", { name: "Sample revisits" }).click();
    const row = (bill) => tech.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row(overdue)).toContainText("Overdue");
    await expect(row(today)).toContainText("Today");
    await expect(row(later)).toHaveCount(0);

    await tech.locator(".ant-segmented").getByText("All pending", { exact: true }).click();
    await expect(row(later)).toContainText("Later");
    await expect(row(later)).toContainText(pickerTime(48).slice(0, 10));
    await expect(row(overdue)).toBeVisible();
    // Each row names the patient, their phone, the test and which sample.
    for (const text of [later.patient.name, later.patient.phone, "GTT · Glucose tolerance", "2 h"]) await expect(row(later)).toContainText(text);
  });

  test("a sample recorded from the revisit list shows on its bill, with who took it", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(-1) });
    const other = await loginAs(users.tech2); // not the technician who billed it
    await other.goto("/revisits");
    const row = other.getByRole("row", { name: new RegExp(bill.billNumber) });
    await row.getByRole("button", { name: "Mark collected" }).click();
    await other.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(other.getByText(`GTT (2 h) is collected for ${bill.patient.name}.`)).toBeVisible();
    await expect(row).toBeHidden();

    await other.goto(`/bills/${bill.id}`);
    await expect(sampleRow(other, /Glucose tolerance 2 h/)).toContainText("Collected");
    const collected = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, sequence: 3 }, include: { collectedBy: true } });
    expect(collected.collectedBy.name).toBe(users.tech2.name);
    expect(Math.abs(collected.collectedAt.getTime() - Date.now())).toBeLessThan(60e3);
  });

  test("a row collected at another desk meanwhile: the technician is told when they try", async ({ loginAs, users, techApi, api }) => {
    const bill = await gttBill(techApi, { 3: hours(-1) });
    const tech = await loginAs(users.tech1);
    await tech.goto("/revisits");
    const row = tech.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toBeVisible();
    const pending = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, status: "pending" } });
    await (await api(users.tech2)).call("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending.id] });

    await row.getByRole("button", { name: "Mark collected" }).click();
    await tech.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(tech.getByText("Some of those samples are already collected.")).toBeVisible();
  });

  test("after 'already collected', the bill and the revisit list show the sample as it now is, without a reload", async ({ loginAs, users, techApi, api }) => {
    const bill = await gttBill(techApi, { 3: hours(-1) });
    const pending = await db().sampleCollection.findFirst({ where: { billItem: { billId: bill.id }, status: "pending" } });
    const onBill = await loginAs(users.tech1);
    await onBill.goto(`/bills/${bill.id}`);
    await onBill.getByLabel("Select GTT 2 h").check();
    const onList = await loginAs(users.tech1);
    await onList.goto("/revisits");
    const row = onList.getByRole("row", { name: new RegExp(bill.billNumber) });
    await expect(row).toBeVisible();
    await (await api(users.tech2)).call("PATCH", `/bills/${bill.id}/samples`, { collectionIds: [pending.id] });

    await onBill.getByRole("button", { name: "Record collection" }).click();
    await onBill.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(onBill.getByText("Some of those samples are already collected.")).toBeVisible();
    await row.getByRole("button", { name: "Mark collected" }).click();
    await onList.getByRole("tooltip").getByRole("button", { name: "Mark collected" }).click();
    await expect(onList.getByText("Some of those samples are already collected.")).toBeVisible();

    await expect(sampleRow(onBill, /Glucose tolerance 2 h/)).toContainText("Collected");
    await expect(row).toBeHidden();
  });

  test("Home counts who is due back today and lists them, linked to their bills", async ({ loginAs, users, techApi }) => {
    const bill = await gttBill(techApi, { 3: hours(-3) });
    const tech = await loginAs(users.tech1);
    const due = section(tech, "Due back for samples");
    await expect(due).toBeVisible();
    const pendingToday = await db().sampleCollection.count({
      where: { status: "pending", billItem: { status: "active" }, dueAt: { lte: new Date(`${istDate()}T23:59:59.999+05:30`) } },
    });
    // Home lists the ten soonest; this one may be beyond them when many are due.
    if (pendingToday <= 10) {
      await expect(due.getByRole("row", { name: new RegExp(bill.billNumber) })).toContainText("GTT · 2 h");
      await due.getByRole("link", { name: bill.billNumber }).click();
      await expect(tech.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
    } else {
      await due.getByRole("link", { name: "All revisits" }).click();
      await expect(tech.getByRole("row", { name: new RegExp(bill.billNumber) })).toBeVisible();
    }
  });

  test("the printed revisit list follows the screen's choice: due by today, or all pending", async ({ loginAs, users, techApi }) => {
    const [today, later] = [await gttBill(techApi, { 3: hours(-1) }), await gttBill(techApi, { 3: hours(72) })];
    const tech = await loginAs(users.tech1);
    await tech.goto("/revisits");
    let [popup] = await Promise.all([tech.waitForEvent("popup"), tech.getByRole("button", { name: "Print list" }).click()]);
    let sheet = popup.getByRole("main", { name: "Sample revisits" });
    await expect(sheet).toContainText(`Due by ${dmy(istDate())}`);
    await expect(sheet).toContainText(today.billNumber);
    await expect(sheet).not.toContainText(later.billNumber);
    await popup.close();

    await tech.locator(".ant-segmented").getByText("All pending", { exact: true }).click();
    await expect(tech.getByRole("row", { name: new RegExp(later.billNumber) })).toBeVisible();
    [popup] = await Promise.all([tech.waitForEvent("popup"), tech.getByRole("button", { name: "Print list" }).click()]);
    sheet = popup.getByRole("main", { name: "Sample revisits" });
    await expect(sheet).toContainText("All pending");
    await expect(sheet).toContainText(later.billNumber);
    await expect(sheet).toContainText(later.patient.phone);
  });
});
