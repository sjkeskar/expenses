// Shared Playwright fixtures. Every spec imports { test, expect } from here.
//
//   users    — the seeded fixed users (see helpers/seed.js), with passwords.
//   api      — factory: await api(user) -> logged-in ApiClient (auto-disposed).
//   leadApi  — ready-made ApiClient logged in as the seeded lead pathologist.
//   techApi  — ready-made ApiClient logged in as the seeded technician tech1.
//   loginAs  — factory: await loginAs(user) -> Page signed in and on Home.
//              Each call is its own browser context (own session).
const base = require("@playwright/test");
const { ApiClient } = require("./helpers/api");
const { USERS, PASSWORD } = require("./helpers/seed");

const users = Object.fromEntries(Object.entries(USERS).map(([key, u]) => [key, { ...u, password: PASSWORD }]));

const test = base.test.extend({
  users: async ({}, use) => {
    await use(users);
  },

  api: async ({}, use) => {
    const clients = [];
    await use(async (user) => {
      const client = await ApiClient.as(user);
      clients.push(client);
      return client;
    });
    await Promise.all(clients.map((c) => c.dispose()));
  },

  leadApi: async ({ api }, use) => {
    await use(await api(users.lead));
  },

  techApi: async ({ api }, use) => {
    await use(await api(users.tech1));
  },

  loginAs: async ({ browser }, use) => {
    const contexts = [];
    await use(async (user) => {
      const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, reducedMotion: "reduce", acceptDownloads: true });
      contexts.push(context);
      // Print views open the print dialog; here it only counts the calls.
      await context.addInitScript(() => {
        window.print = () => {
          window.__printed = (window.__printed || 0) + 1;
        };
      });
      // context.request shares the browser context's cookies, so an API
      // sign-in gives the page a real session without driving the form
      // (the form has its own spec).
      const res = await context.request.post("/api/auth/login", { data: { name: user.name, password: user.password } });
      if (!res.ok()) throw new Error(`loginAs(${user.name}) failed: ${res.status()}`);
      const page = await context.newPage();
      await page.goto("/");
      await page.getByRole("banner").getByText(user.name, { exact: true }).waitFor();
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

// Marks the current test as reproducing a known, still-open bug (see
// bugs/Open/). The test asserts the CORRECT behaviour and is expected to
// fail; once the bug is fixed it "unexpectedly passes", Playwright reports
// that as a failure, and that's the cue to move the bug file to
// bugs/Closed/ and delete this call.
//
// E2E_SHOW_BUGS=1 runs these as ordinary tests, to see the actual failures.
function knownBug(id) {
  test.info().annotations.push({ type: "bug", description: `${id} — see bugs/*/${id}-*.md` });
  if (!process.env.E2E_SHOW_BUGS) test.fail(true, `Known open bug ${id}`);
}

module.exports = { test, expect: base.expect, users, knownBug };
