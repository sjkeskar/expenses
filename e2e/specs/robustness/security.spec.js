// Defence-in-depth headers, and user text stored exactly as typed (the new
// frontend escapes on render; XSS-on-screen specs return with it in Step 2).
const { test, expect } = require("../../fixtures");

test.describe("Headers and stored text", () => {
  test("pages send a Content-Security-Policy that blocks inline scripts", async ({ request }) => {
    const res = await request.get("/login.html");
    const csp = res.headers()["content-security-policy"];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test("API responses are never cacheable", async ({ techApi }) => {
    const res = await techApi.ctx.fetch("/api/catalog");
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("HTML and Unicode in names are stored and returned exactly as typed", async ({ techApi }) => {
    const name = `<img src=x onerror=alert(1)> ಕನ್ನಡ ${"x".repeat(150)}`;
    const patient = await techApi.registerPatient({ name });
    expect(patient.name).toBe(name);
  });
});
