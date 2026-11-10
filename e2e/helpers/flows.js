// Shared steps for the role-journey UI specs (specs/ui/journey-*.spec.js):
// locators the screens share, and data the API can arrange quickly (a
// throwaway test with its own price, an expired quotation, a running camp).
const { expect } = require("@playwright/test");
const { db, baseline } = require("./db");
const { uid, istDate } = require("./data");

// A labelled figure (components/Page.tsx Figures), e.g. "Net amount".
const figure = (page, label) => page.getByRole("group", { name: label, exact: true });
const billHeading = (page) => page.getByRole("heading", { name: /^Bill \d+/ });
const createBill = (page) => page.getByRole("button", { name: "Create bill" }).last().click();
const saveQuote = (page) => page.getByRole("button", { name: "Save & print" }).last().click();

// A screen's section (components/Page.tsx Section), by its heading.
const section = (page, title) => page.locator(".ant-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
// The "Report on hold" notice of a bill page, with its reasons.
const holdNotice = (page) => page.getByRole("alert").filter({ hasText: "Report on hold" });

// Picks `option` in the dropdown whose accessible name starts with `name`
// (an optional field's name ends in "(optional)").
async function pick(page, name, option, within = page) {
  const box = within.getByRole("combobox", { name: new RegExp(`^${name}`) });
  await box.click();
  await box.fill(option);
  await page.locator(".ant-select-dropdown:visible").getByTitle(option, { exact: true }).click();
}

// "DD/MM/YYYY hh:mm AM" for a time `hours` from now, as the date-time
// pickers take it and the screens show it (IST, 12-hour).
function pickerTime(hours, from = new Date()) {
  const d = new Date(from.getTime() + hours * 3600e3);
  const [y, m, day] = istDate(d).split("-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  return `${day}/${m}/${y} ${time}`;
}

// "DD/MM/YYYY" of an IST day given as YYYY-MM-DD.
const dmy = (yyyyMmDd) => yyyyMmDd.split("-").reverse().join("/");

// Types a value into an antd date (or date-time) picker and confirms it.
async function fillPicker(field, text) {
  await field.click();
  await field.fill(text);
  await field.press("Enter");
}

// A catalog code no other spec uses.
const newCode = (prefix = "J") => `${prefix}${uid("").replace(/[^a-z0-9]/gi, "").slice(-9)}`.toUpperCase();

// A throwaway catalog item, added by the lead (applies at once). Returns the
// row, so its price can change or it can be retired without touching the baseline.
async function addCatalogItem(leadApi, { code = newCode(), name, kind = "test", price = 100, ...values } = {}) {
  await leadApi.call("POST", "/catalog/changes", { changes: [{ action: "create", values: { code, name: name ?? `E2E ${code}`, kind, price, ...values } }] });
  return baseline.item(code);
}

async function setPrice(leadApi, item, price) {
  await leadApi.call("POST", "/catalog/changes", {
    changes: [{ action: "update", catalogItemId: item.id, values: { code: item.code, name: item.name, kind: item.kind, price, draws: item.draws?.map((d) => d.label) } }],
  });
}

const retire = (leadApi, item) => leadApi.call("POST", "/catalog/changes", { changes: [{ action: "retire", catalogItemId: item.id }] });

// Moves a quotation's issue time back, so its 48 hours ran out `hoursAgo - 48` hours ago.
async function expireQuote(quoteId, hoursAgo = 50) {
  const issuedAt = new Date(Date.now() - hoursAgo * 3600e3);
  await db().quotation.update({ where: { id: quoteId }, data: { issuedAt, validUntil: new Date(issuedAt.getTime() + 48 * 3600e3) } });
}

// A panel's camp at the baseline branch, running now unless the hours say otherwise.
async function addCamp(leadApi, panel, { startsIn = -1, endsIn = 24, ...fields } = {}) {
  const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const body = { panelId: panel.id, name: uid("Camp"), locationId: (await baseline.branch()).id, startsAt: at(startsIn), endsAt: at(endsIn), items: [], ...fields };
  return (await leadApi.call("POST", "/camps", body)).camp;
}

// Approves or rejects the queue row matching `rowText`, as the signed-in reviewer.
async function decide(page, rowText, decision, note) {
  await page.goto("/approvals");
  const row = page.getByRole("row", { name: new RegExp(rowText) });
  if (decision === "approve") {
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("tooltip").getByRole("button", { name: "Approve" }).click();
  } else {
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject request" });
    if (note) await dialog.getByLabel("Note").fill(note);
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(row).toBeHidden();
}

// Fills the new patient's fields on a bill (or a converted quote).
async function fillNewPatient(page, { name, phone, age = 35, sex = "Female" } = {}) {
  if (name !== undefined) await page.getByLabel("Full name").fill(name);
  if (phone !== undefined) await page.getByLabel("Phone", { exact: true }).fill(phone);
  await page.getByLabel("Age (years)").fill(String(age));
  await page.getByLabel(sex, { exact: true }).check();
}

module.exports = {
  figure, billHeading, createBill, saveQuote, section, holdNotice, pick, pickerTime, dmy, fillPicker, newCode,
  addCatalogItem, setPrice, retire, expireQuote, addCamp, decide, fillNewPatient,
};
