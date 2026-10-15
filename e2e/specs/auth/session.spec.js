// A10, A12, C9: session lifetime, server restarts, and what happens to a
// live session when the account behind it changes.
const { test, expect } = require("../../fixtures");
const { startServer } = require("../../helpers/server");
const { createUser } = require("../../helpers/db");

test.describe("Session lifetime (dedicated short-session server)", () => {
  test.describe.configure({ mode: "serial" });

  test("A10: an expired session sends the next page load back to login", async ({ browser }) => {
    const server = await startServer({ port: 8091, env: { SESSION_MAX_AGE_MS: "2000" } });
    try {
      const user = await createUser("operator");
      const context = await browser.newContext({ baseURL: server.baseURL });
      const page = await context.newPage();
      await page.goto("/login.html");
      await page.locator("#name").fill(user.name);
      await page.locator("#password").fill(user.password);
      await page.locator('#login-form button[type="submit"]').click();
      await expect(page).toHaveURL(/operator\.html$/);

      await page.waitForTimeout(2500);
      await page.reload();
      await expect(page).toHaveURL(/login\.html$/);
      await context.close();
    } finally {
      await server.stop();
    }
  });

  test("A12: restarting the server logs everyone out (in-memory session store)", async ({ browser }) => {
    let server = await startServer({ port: 8092 });
    const user = await createUser("admin");
    const context = await browser.newContext({ baseURL: server.baseURL });
    try {
      await context.request.post("/api/auth/login", { data: { name: user.name, password: user.password } });
      expect((await context.request.get("/api/auth/me")).status()).toBe(200);

      await server.stop();
      server = await startServer({ port: 8092 });

      expect((await context.request.get("/api/auth/me")).status()).toBe(401);
      const page = await context.newPage();
      await page.goto("/admin.html");
      await expect(page).toHaveURL(/login\.html$/);
    } finally {
      await context.close();
      await server.stop();
    }
  });
});

test.describe("Live sessions after account changes", () => {
  test("C9a: a deactivated user's existing session stops working", async ({ api, users }) => {
    const victim = await createUser("operator");
    const session = await api(victim);
    expect((await session.raw("GET", "/bills")).status).toBe(200);

    const dev = await api(users.dev);
    await dev.call("DELETE", `/users/${victim.id}`);

    expect((await session.raw("GET", "/bills")).status).toBe(401);
  });

  test("C9b: a demoted admin loses admin rights in their existing session", async ({ api, users }) => {
    const admin = await createUser("admin");
    const session = await api(admin);
    expect((await session.raw("GET", "/users/reassign-targets")).status).toBe(200);

    const dev = await api(users.dev);
    await dev.call("PATCH", `/users/${admin.id}/demote`);

    expect((await session.raw("GET", "/users/reassign-targets")).status).toBe(403);
  });

  test("C9c: a promoted operator is moved to the admin page on next login", async ({ api, users, loginAs }) => {
    const op = await createUser("operator");
    const adminApi = await api(users.admin);
    await adminApi.call("PATCH", `/users/${op.id}/promote`);
    const page = await loginAs({ ...op, role: "admin" });
    await expect(page).toHaveURL(/admin\.html$/);
    await expect(page.locator("#user-name")).toHaveText(`${op.name} (admin)`);
  });

  test("C9d: the change-password endpoint refuses a session whose account was deactivated", async ({ api, users }) => {
    const victim = await createUser("operator");
    const session = await api(victim);
    const dev = await api(users.dev);
    await dev.call("DELETE", `/users/${victim.id}`);
    const { status } = await session.raw("PATCH", "/auth/password", {
      currentPassword: victim.password,
      newPassword: "Another@1",
    });
    expect(status).toBe(401);
  });
});
