// Playwright config for the end-to-end UI test pack (see e2e/README.md).
//
// Test environment comes from .env.test (a separate *_test database). The app server is started on its own port (E2E_PORT, default
// 8090) so it never collides with a dev server already running on 8080.
// Values exported here into process.env take precedence over the app's own
// .env, because dotenv never overrides variables that are already set.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env.test") });

const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.E2E_PORT || "8090";
process.env.PORT = PORT;
process.env.E2E_BASE_URL = `http://localhost:${PORT}`;

// Reduced motion switches antd's animations off (client/src/main.tsx), so
// dialogs and messages appear at once and specs never race an animation.
const CHROME = { ...devices["Desktop Chrome"], contextOptions: { reducedMotion: "reduce" } };

module.exports = defineConfig({
  testDir: "./e2e/specs",
  globalSetup: require.resolve("./e2e/global-setup.js"),
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    },
  outputDir: "e2e/test-results",
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    actionTimeout: 10_000,
  },
  // specs/lead/ changes who the lead pathologist is, which every other spec
  // relies on, so it runs on its own, serially, after everything else.
  projects: [
    { name: "chromium", use: CHROME, testIgnore: /specs\/lead\// },
    { name: "lead", use: CHROME, testMatch: /specs\/lead\/.*\.spec\.js/, dependencies: ["chromium"] },
  ],
  webServer: {
    // Builds the frontend first, so UI specs always run against the current client/.
    command: "npm run build && node src/server.js",
    url: `${process.env.E2E_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, PORT },
    stdout: "ignore",
    stderr: "pipe",
  },
});
