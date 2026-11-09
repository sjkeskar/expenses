// No screen is ever left blank by a failed load (BUG-021). For every route
// in client/src/pages.tsx (screens and prints): with every data request
// failing, the screen shows its error page (Home, whose data is all
// optional widgets, shows the failure as a message instead); and a record
// that doesn't exist says so. The shell's own requests fail too, so this
// also checks the menu and header survive them. The contract lives in useApi (lib/hooks.ts) and
// the per-route ErrorBoundary (App.tsx); this spec holds every screen to it.
//
// A new route needs a sample below, or the first test fails.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("../../fixtures");

const MISSING = "00000000-0000-0000-0000-000000000000";
const FAILURE = "E2E: the server failed.";

// Every route, with a URL to open it at and who opens it (a role it allows).
// `widgets`: everything the screen loads is optional; `nothing`: it loads
// nothing of its own (only the shell's requests fail around it).
const SAMPLES = {
  "/": { url: "/", as: "tech1", widgets: true },
  "/patients": { url: "/patients", as: "tech1" },
  "/patients/:id": { url: `/patients/${MISSING}`, as: "tech1" },
  "/quotations": { url: "/quotations", as: "tech1" },
  "/quotations/new": { url: "/quotations/new", as: "tech1" },
  "/quotations/:id": { url: `/quotations/${MISSING}`, as: "tech1" },
  "/bills": { url: "/bills", as: "tech1" },
  "/bills/new": { url: "/bills/new", as: "tech1" },
  "/bills/:id": { url: `/bills/${MISSING}`, as: "tech1" },
  "/revisits": { url: "/revisits", as: "tech1" },
  "/daysheet": { url: "/daysheet", as: "tech1" },
  "/settlement": { url: "/settlement", as: "tech1" },
  "/verify": { url: "/verify", as: "tech1", nothing: true },
  "/catalog": { url: "/catalog", as: "tech1" },
  "/catalog/entry": { url: "/catalog/entry", as: "tech1" },
  "/doctors": { url: "/doctors", as: "tech1" },
  "/machines": { url: "/machines", as: "lead" },
  "/approvals": { url: "/approvals", as: "path1" },
  "/requests": { url: "/requests", as: "tech1" },
  "/analytics": { url: "/analytics", as: "acct" },
  "/panels": { url: "/panels", as: "lead" },
  "/locations": { url: "/locations", as: "lead" },
  "/users": { url: "/users", as: "lead" },
  "/settings": { url: "/settings", as: "lead" },
  "/setup": { url: "/setup", as: "dev" },
  "/print/bill/:id": { url: `/print/bill/${MISSING}`, as: "tech1" },
  "/print/quotation/:id": { url: `/print/quotation/${MISSING}`, as: "tech1" },
  "/print/day-sheet": { url: "/print/day-sheet", as: "tech1" },
  "/print/revisits": { url: "/print/revisits", as: "tech1" },
};

// Screens opened for a record that doesn't exist, and the message expected.
const NOT_FOUND = [
  [`/bills/${MISSING}`, "Bill not found."],
  [`/quotations/${MISSING}`, "Quotation not found."],
  [`/patients/${MISSING}`, "Patient not found."],
  [`/bills/new?quotation=${MISSING}`, "Quotation not found."],
  [`/bills/new?patient=${MISSING}`, "Patient not found."],
  [`/quotations/new?patient=${MISSING}`, "Patient not found."],
  [`/print/bill/${MISSING}`, "Bill not found."],
  [`/print/quotation/${MISSING}`, "Quotation not found."],
];

// The routes as the app declares them: every `path: "…"` in pages.tsx.
function declaredRoutes() {
  const source = fs.readFileSync(path.join(__dirname, "../../../client/src/pages.tsx"), "utf8");
  return [...source.matchAll(/\bpath: "([^"]+)"/g)].map((m) => m[1]);
}

test("every route has a sample here", () => {
  const routes = declaredRoutes();
  expect(routes.length).toBeGreaterThan(20); // the pattern still finds them
  expect(routes.filter((r) => !SAMPLES[r])).toEqual([]);
});

test.describe("With every data request failing, the failure is shown", () => {
  for (const [route, { url, as, widgets, nothing }] of Object.entries(SAMPLES)) {
    test(route, async ({ loginAs, users }) => {
      const page = await loginAs(users[as]);
      // Every read fails, except the session check that keeps the user signed in.
      await page.route("**/api/**", (r) => {
        const req = r.request();
        if (req.method() !== "GET" || new URL(req.url()).pathname.startsWith("/api/auth/")) return r.continue();
        return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: FAILURE }) });
      });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      if (widgets || nothing) {
        // The screen itself shows, with the failure as a message.
        await expect(page.getByText(FAILURE).first()).toBeVisible();
        await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
        await expect(page.getByText("This page couldn't be loaded")).toHaveCount(0);
      } else {
        await expect(page.getByText("This page couldn't be loaded")).toBeVisible();
        await expect(page.getByText(FAILURE).first()).toBeVisible();
      }
    });
  }
});

test.describe("A record that doesn't exist says so", () => {
  for (const [url, text] of NOT_FOUND) {
    test(url, async ({ loginAs, users }) => {
      const page = await loginAs(users.tech1);
      await page.goto(url);
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Go to Home" })).toBeVisible();
    });
  }
});

test("a detail screen's not-found page leads back to its list", async ({ loginAs, users }) => {
  const page = await loginAs(users.tech1);
  await page.goto(`/bills/${MISSING}`);
  await page.getByRole("button", { name: "Back to Bills" }).click();
  await expect(page.getByRole("heading", { name: "Bills", exact: true })).toBeVisible();
});

test("a failed load can be retried, and the menu still works around it", async ({ loginAs, users }) => {
  const page = await loginAs(users.tech1);
  let fail = true;
  await page.route("**/api/bills?*", (r) =>
    fail ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: FAILURE }) }) : r.continue()
  );
  await page.goto("/bills");
  await expect(page.getByText("This page couldn't be loaded")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("This page couldn't be loaded")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bills", exact: true })).toBeVisible();

  fail = true;
  await page.reload();
  await expect(page.getByText("This page couldn't be loaded")).toBeVisible();
  await page.getByRole("menuitem", { name: "Quotations" }).click();
  await expect(page.getByRole("heading", { name: "Quotations", exact: true })).toBeVisible();
  await expect(page.getByText("This page couldn't be loaded")).toHaveCount(0);
});

test("a refresh that fails keeps the record on screen, with a message", async ({ loginAs, users, techApi }) => {
  const bill = await techApi.createBill({ items: ["GLUF"] });
  const page = await loginAs(users.tech1);
  await page.goto(`/bills/${bill.id}`);
  await expect(page.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
  await page.route(`**/api/bills/${bill.id}`, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: FAILURE }) }) : r.continue()
  );
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("dialog", { name: "Report expected by" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(FAILURE)).toBeVisible();
  await expect(page.getByRole("heading", { name: `Bill ${bill.billNumber}` })).toBeVisible();
});

test("optional data failing leaves the screen usable: New bill without its most-used tiles", async ({ loginAs, users }) => {
  const page = await loginAs(users.tech1);
  await page.route("**/api/catalog/popular", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: FAILURE }) }));
  await page.goto("/bills/new");
  await expect(page.getByText(FAILURE)).toBeVisible();
  await expect(page.getByRole("heading", { name: "New bill" })).toBeVisible();
  await expect(page.getByLabel("Add a test, profile or service")).toBeVisible();
});
