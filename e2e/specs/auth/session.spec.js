// Session lifetime and server restarts, on dedicated app servers (the
// session store is in memory, and the lifetime comes from the environment).
const { test, expect, request } = require("@playwright/test");
const { startServer } = require("../../helpers/server");
const { createUser } = require("../../helpers/db");

test.describe.configure({ mode: "serial" });

async function signedIn(baseURL, user) {
  const ctx = await request.newContext({ baseURL });
  await ctx.post("/api/auth/login", { data: { name: user.name, password: user.password } });
  return ctx;
}

test("an expired session is refused on the next request", async () => {
  const server = await startServer({ port: 8091, env: { SESSION_MAX_AGE_MS: "1500" } });
  const user = await createUser("technician");
  const ctx = await signedIn(server.baseURL, user);
  try {
    expect((await ctx.get("/api/auth/me")).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await ctx.get("/api/auth/me")).status()).toBe(401);
  } finally {
    await ctx.dispose();
    await server.stop();
  }
});

test("restarting the server signs everyone out (in-memory session store)", async () => {
  let server = await startServer({ port: 8092 });
  const user = await createUser("technician");
  const ctx = await signedIn(server.baseURL, user);
  try {
    expect((await ctx.get("/api/auth/me")).status()).toBe(200);
    await server.stop();
    server = await startServer({ port: 8092 });
    expect((await ctx.get("/api/auth/me")).status()).toBe(401);
  } finally {
    await ctx.dispose();
    await server.stop();
  }
});
