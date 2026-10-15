// Playwright config for the end-to-end UI test pack (see e2e/README.md).
//
// Test environment comes from .env.test (separate payment_tracking_test
// database). The app server is started on its own port (E2E_PORT, default
// 8090) so it never collides with a dev server already running on 8080.
// Values exported here into process.env take precedence over the app's own
// .env, because dotenv never overrides variables that are already set.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env.test") });

const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.E2E_PORT || "8090";
process.env.PORT = PORT;
process.env.E2E_BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: "./e2e/specs",
  globalSetup: require.resolve("./e2e/global-setup.js"),
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Rendering is deterministic (mocked API, frozen clock, no web fonts), so the
    // tolerance is tight: a ratio-based limit let a badge text-colour change
    // (a few hundred anti-aliased glyph pixels) slip through.
    toHaveScreenshot: { maxDiffPixels: 10, threshold: 0.05, animations: "disabled", caret: "hide" },
  },
  // Visual baselines (specs/visual): one folder, platform-specific names.
  snapshotPathTemplate: "e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  outputDir: "e2e/test-results",
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    actionTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node src/server.js",
    url: `${process.env.E2E_BASE_URL}/login.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, PORT },
    stdout: "ignore",
    stderr: "pipe",
  },
});
