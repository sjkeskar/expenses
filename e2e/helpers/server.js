// Spawns an additional, independent app server (same test DB) for specs that
// need non-default server settings (e.g. a very short session lifetime) or
// need to restart the process mid-test.
const { spawn } = require("child_process");
const path = require("path");

async function waitForUp(baseURL, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/login.html`);
      if (res.ok) return;
    } catch (_) {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseURL} did not start within ${timeoutMs}ms`);
}

async function startServer({ port, env = {} }) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: "ignore",
  });
  const baseURL = `http://localhost:${port}`;
  await waitForUp(baseURL);
  return {
    baseURL,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await exited;
    },
  };
}

module.exports = { startServer };
