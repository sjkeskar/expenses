// Changing the lead pathologist (pivot.md §3.3) and first-run setup (§3.4).
// This changes who the lead is, which every other spec relies on, so it
// runs in its own "lead" project after all of them, one test at a time,
// and hands the lead back each time. So does anything else that changes
// lab-wide state. First-run setup runs last of all.
const { test, expect } = require("../../fixtures");
const { createUser, db } = require("../../helpers/db");
const { ApiClient } = require("../../helpers/api");
const { uid } = require("../../helpers/data");
const { chooseOption } = require("../../helpers/ui");
const { BASELINE } = require("../../helpers/seed");

test.describe.configure({ mode: "serial" });

const roleOf = async (name) => (await db().user.findUnique({ where: { name } })).role;
const DAY = 24 * 60 * 60 * 1000;

test("the lead hands over to a pathologist and becomes one; the new lead can hand back", async ({ users, leadApi }) => {
  const pathologist = await createUser("pathologist");
  const newLead = await ApiClient.as(pathologist);
  try {
    expect((await leadApi.raw("POST", "/users/lead/handover", { pathologistId: (await db().user.findUnique({ where: { name: users.tech1.name } })).id })).status).toBe(400);
    await leadApi.call("POST", "/users/lead/handover", { pathologistId: pathologist.id });
    expect(await roleOf(users.lead.name)).toBe("pathologist");
    expect(await roleOf(pathologist.name)).toBe("lead_pathologist");
    // The old lead's live session has a pathologist's rights from the next request.
    expect((await leadApi.raw("GET", "/users")).status).toBe(403);
    expect((await leadApi.raw("GET", "/approvals")).status).toBe(200);
    expect(await db().user.count({ where: { role: "lead_pathologist", isDeleted: false } })).toBe(1);

    const original = await db().user.findUnique({ where: { name: users.lead.name } });
    await newLead.call("POST", "/users/lead/handover", { pathologistId: original.id });
    expect(await roleOf(users.lead.name)).toBe("lead_pathologist");
    const terms = await db().leadTerm.findMany({ where: { userId: pathologist.id } });
    expect(terms).toEqual([expect.objectContaining({ reason: "handover", endedAt: expect.any(Date) })]);
  } finally {
    await newLead.dispose();
  }
});

test("two hand-overs at once leave exactly one lead", async ({ users, leadApi }) => {
  const [a, b] = await Promise.all([createUser("pathologist"), createUser("pathologist")]);
  const results = await Promise.all([a, b].map((p) => leadApi.raw("POST", "/users/lead/handover", { pathologistId: p.id })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 403].sort());
  expect(await db().user.count({ where: { role: "lead_pathologist", isDeleted: false } })).toBe(1);

  const winner = results[0].status === 200 ? a : b;
  const original = await db().user.findUnique({ where: { name: users.lead.name } });
  await (await ApiClient.as(winner)).call("POST", "/users/lead/handover", { pathologistId: original.id });
});

test("the developer can re-appoint only after 7 days without the lead signing in", async ({ api, users }) => {
  const dev = await api(users.dev);
  const pathologist = await createUser("pathologist");
  const tooSoon = await dev.raw("POST", "/users/lead/appoint", { pathologistId: pathologist.id });
  expect(tooSoon.status).toBe(409);

  const lead = await db().user.findUnique({ where: { name: users.lead.name } });
  const old = new Date(Date.now() - 8 * DAY);
  await db().user.update({ where: { id: lead.id }, data: { lastLoginAt: old } });
  await db().leadTerm.updateMany({ where: { userId: lead.id, endedAt: null }, data: { startedAt: old } });
  expect((await dev.call("GET", "/users/lead")).lead.inactive).toBe(true);

  await dev.call("POST", "/users/lead/appoint", { pathologistId: pathologist.id });
  expect(await roleOf(pathologist.name)).toBe("lead_pathologist");
  expect(await roleOf(users.lead.name)).toBe("pathologist");
  expect(await db().leadTerm.findFirst({ where: { userId: pathologist.id, endedAt: null } })).toMatchObject({ reason: "inactive_lead" });

  await (await ApiClient.as(pathologist)).call("POST", "/users/lead/handover", { pathologistId: lead.id });
});

test("in the app: the lead's lab settings change shows in the header at once", async ({ loginAs, users, leadApi }) => {
  const lead = await loginAs(users.lead);
  await lead.goto("/settings");
  await expect(lead.getByLabel("Lab name")).toHaveValue(BASELINE.settings.labName);
  await lead.getByLabel("Lab name").fill("E2E Diagnostics (renamed)");
  await lead.getByRole("button", { name: "Save" }).click();
  await expect(lead.getByRole("banner")).toContainText("E2E Diagnostics (renamed)");
  await leadApi.call("PATCH", "/settings", BASELINE.settings);
});


// Makes the seeded lead look away for 8 days, so the developer may re-appoint.
async function leadAway(users) {
  const lead = await db().user.findUnique({ where: { name: users.lead.name } });
  const old = new Date(Date.now() - 8 * DAY);
  await db().user.update({ where: { id: lead.id }, data: { lastLoginAt: old } });
  await db().leadTerm.updateMany({ where: { userId: lead.id, endedAt: null }, data: { startedAt: old } });
  return lead;
}

test("in the app: the lead hands over from Users, is warned, and loses the lead's screens", async ({ loginAs, users }) => {
  const pathologist = await createUser("pathologist");
  const page = await loginAs(users.lead);
  await page.goto("/users");
  await chooseOption(page, "New lead pathologist", pathologist.name);
  await page.getByRole("button", { name: "Hand over" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Hand over as lead pathologist?" });
  await expect(dialog).toContainText(`You are making ${pathologist.name} the lead pathologist. Your own account will become a pathologist account.`);
  await dialog.getByRole("button", { name: "Hand over", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  // A pathologist's menu now: the approval queue stays, the lead's screens go.
  const menu = page.getByRole("navigation", { name: "Main" });
  await expect(menu.getByRole("menuitem", { name: "Approval queue" })).toBeVisible();
  for (const name of ["Users", "Analytics", "Machines", "Panels & camps"]) await expect(menu.getByRole("menuitem", { name })).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("Pathologist");

  const original = await db().user.findUnique({ where: { name: users.lead.name } });
  await (await ApiClient.as(pathologist)).call("POST", "/users/lead/handover", { pathologistId: original.id });
});

test("in the app: the developer appoints a lead once the lead has been away 7 days", async ({ loginAs, users }) => {
  const pathologist = await createUser("pathologist");
  const lead = await leadAway(users);
  const page = await loginAs(users.dev);
  await page.goto("/setup");
  await chooseOption(page, "Pathologist to appoint", pathologist.name);
  await page.getByRole("button", { name: "Appoint as lead" }).click();
  await page.getByRole("dialog").filter({ hasText: "Appoint a new lead pathologist?" }).getByRole("button", { name: "Appoint", exact: true }).click();

  await expect(page.getByRole("main")).toContainText(`Current lead${pathologist.name}`);
  expect(await roleOf(pathologist.name)).toBe("lead_pathologist");
  await (await ApiClient.as(pathologist)).call("POST", "/users/lead/handover", { pathologistId: lead.id });
});

test("first-run setup creates the lab settings and the first lead, once", async ({ api, users }) => {
  // Return the database to a never-set-up lab.
  await db().labSettings.deleteMany();
  await db().user.updateMany({ where: { role: "lead_pathologist" }, data: { role: "pathologist" } });

  const dev = await api(users.dev);
  const body = { labName: "New Lab", phone: "0300000000", address: "9 First Street", lead: { name: uid("lead"), password: "Lead@123" } };
  expect((await dev.raw("POST", "/settings/setup", { ...body, lead: { name: body.lead.name, password: "weak" } })).status).toBe(400);
  const { settings, lead } = await dev.call("POST", "/settings/setup", body);
  expect(settings.labName).toBe("New Lab");
  expect(await roleOf(lead.name)).toBe("lead_pathologist");
  expect((await dev.raw("POST", "/settings/setup", body)).status).toBe(409);

  const newLead = await ApiClient.as({ name: lead.name, password: "Lead@123" });
  expect((await newLead.raw("GET", "/users")).status).toBe(200);
  await newLead.dispose();
});

test("in the app: first-run setup on an empty lab, and the new lead can sign in", async ({ loginAs, users, page }) => {
  await db().labSettings.deleteMany();
  await db().user.updateMany({ where: { role: "lead_pathologist" }, data: { role: "pathologist" } });

  const dev = await loginAs(users.dev);
  await expect(dev.getByText("The lab hasn't been set up yet")).toBeVisible();
  await dev.getByText("The lab hasn't been set up yet").getByRole("link", { name: "Lab setup" }).click();
  const leadName = uid("lead");
  await dev.getByLabel("Lab name").fill("UI Lab");
  await dev.getByLabel("Phone").fill("0400000000");
  await dev.getByLabel("Address").fill("1 UI Street");
  await dev.getByLabel("Login name").fill(leadName);
  await dev.getByLabel("Password", { exact: true }).fill("Lead@123");
  await dev.getByLabel("Confirm password").fill("Lead@123");
  await dev.getByRole("button", { name: "Set up the lab" }).click();
  await expect(dev.getByRole("banner")).toContainText("UI Lab");
  await expect(dev.getByRole("main")).toContainText(`Current lead${leadName}`);

  await page.goto("/login");
  await page.getByLabel("Login name").fill(leadName);
  await page.getByLabel("Password").fill("Lead@123");
  await page.getByRole("button", { name: "Sign in" }).click();
  const menu = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Users", "Branches & centres", "Lab settings", "Approval queue"]) await expect(menu.getByRole("menuitem", { name })).toBeVisible();
});
