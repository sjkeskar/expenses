// A11 + J2: the full role × endpoint permission matrix, straight against the
// API (UI hiding a button is not access control). Every call uses
// non-existent ids or empty bodies, so allowed roles get a 400/404 and no
// data is ever changed.
const { test, expect } = require("../../fixtures");
const { ApiClient } = require("../../helpers/api");

const NO_ID = "00000000-0000-0000-0000-000000000000";
const O = "operator", A = "admin", D = "developer", C = "accountant";

const MATRIX = [
  ["GET", "/bills", [O, A]],
  ["GET", `/bills/${NO_ID}`, [O, A]],
  ["POST", "/bills", [O, A]],
  ["PATCH", `/bills/${NO_ID}/refund`, [O, A]],
  ["PATCH", `/bills/${NO_ID}/reassign-operator`, [A]],
  ["GET", "/transactions", [O, A]],
  ["POST", "/transactions", [O, A]],
  ["PATCH", `/transactions/${NO_ID}`, [O, A]],
  ["DELETE", `/transactions/${NO_ID}`, [O, A]],
  ["GET", "/clients", [O, A, C]],
  ["POST", "/clients", [O, A]],
  ["GET", "/locations", [O, A]],
  ["POST", "/locations", [A]],
  ["DELETE", `/locations/${NO_ID}`, [A]],
  ["GET", "/categories", [O, A]],
  ["POST", "/categories", [A]],
  ["DELETE", `/categories/${NO_ID}`, [A]],
  ["GET", "/companies", [O, A]],
  ["GET", `/companies/${NO_ID}/outstanding`, [O, A]],
  ["POST", `/companies/${NO_ID}/settle`, [O, A]],
  ["GET", "/users/operators", [A, D]],
  ["GET", "/users/reassign-targets", [A]],
  ["GET", "/users", [D]],
  ["POST", "/users", [D]],
  ["PATCH", `/users/${NO_ID}/promote`, [A, D]],
  ["PATCH", `/users/${NO_ID}/demote`, [D]],
  ["DELETE", `/users/${NO_ID}`, [D]],
  ["GET", "/analytics/day-wise", [A, C]],
  ["GET", "/analytics/operator-wise", [A, C]],
  ["GET", "/analytics/location-wise", [A, C]],
  ["GET", "/analytics/category-wise", [A, C]],
  ["GET", "/analytics/client-outstanding", [A, C]],
  ["GET", `/analytics/client-daily/${NO_ID}`, [A, C]],
  ["GET", `/analytics/client-ledger/${NO_ID}`, [A, C]],
  ["GET", "/auth/me", [O, A, D, C]],
];

const ROLE_USER = { operator: "op1", admin: "admin", developer: "dev", accountant: "acct" };

test.describe("API permission matrix", () => {
  test("A11: unauthenticated requests get 401 on every protected endpoint", async () => {
    const anon = await ApiClient.create();
    try {
      for (const [method, path] of [...MATRIX, ["PATCH", "/auth/password"], ["POST", "/auth/logout"]]) {
        const { status } = await anon.raw(method, path, method === "GET" ? undefined : {});
        expect.soft(status, `${method} ${path}`).toBe(401);
      }
    } finally {
      await anon.dispose();
    }
  });

  for (const role of [O, A, D, C]) {
    test(`A11/J2: ${role} is allowed exactly the endpoints in the matrix`, async ({ api, users }) => {
      const client = await api(users[ROLE_USER[role]]);
      for (const [method, path, allowed] of MATRIX) {
        const { status } = await client.raw(method, path, method === "GET" ? undefined : {});
        if (allowed.includes(role)) {
          expect.soft([401, 403], `${role} should be allowed ${method} ${path} (got ${status})`).not.toContain(status);
          expect.soft(status, `${method} ${path} must not crash`).toBeLessThan(500);
        } else {
          expect.soft(status, `${role} must be forbidden ${method} ${path}`).toBe(403);
        }
      }
    });
  }

  test("K5: unknown /api routes return a JSON 404", async ({ adminApi }) => {
    const { status, body } = await adminApi.raw("GET", "/does-not-exist");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found." });
  });
});
