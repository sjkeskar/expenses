// The full role × endpoint permission matrix (pivot.md §8), straight against
// the API — a hidden button is not access control. Every call uses
// non-existent ids or empty bodies, so allowed roles get a 400/404/409 and
// no data ever changes.
const { test, expect } = require("../../fixtures");
const { ApiClient } = require("../../helpers/api");

const NO_ID = "00000000-0000-0000-0000-000000000000";
const T = "technician", P = "pathologist", L = "lead_pathologist", A = "accountant", D = "developer";
const RECEPTION = [T, P, L];
const READERS = [T, P, L, A];
const OVERSIGHT = [L, A];

const MATRIX = [
  ["GET", "/auth/me", [T, P, L, A, D]],
  ["GET", "/settings", [T, P, L, A, D]],
  ["PATCH", "/settings", [L]],
  ["POST", "/settings/setup", [D]],
  ["GET", "/users", [L]],
  ["POST", "/users", [L]],
  ["GET", "/users/reception", [L]],
  ["GET", "/users/lead", [L, D]],
  ["PATCH", `/users/${NO_ID}/password`, [L]],
  ["DELETE", `/users/${NO_ID}`, [L]],
  ["POST", "/users/lead/handover", [L]],
  ["POST", "/users/lead/appoint", [D]],
  ["GET", "/locations", READERS],
  ["POST", "/locations", [L]],
  ["PATCH", `/locations/${NO_ID}`, [L]],
  ["DELETE", `/locations/${NO_ID}`, [L]],
  ["GET", "/patients?q=x", READERS],
  ["GET", `/patients/${NO_ID}`, READERS],
  ["POST", "/patients", RECEPTION],
  ["POST", `/patients/${NO_ID}/corrections`, RECEPTION],
  ["GET", "/doctors", READERS],
  ["POST", "/doctors", RECEPTION],
  ["GET", "/panels", READERS],
  ["POST", "/panels", [L]],
  ["PATCH", `/panels/${NO_ID}`, [L]],
  ["PUT", `/panels/${NO_ID}/price-list`, [L]],
  ["DELETE", `/panels/${NO_ID}`, [L]],
  ["GET", `/panels/${NO_ID}/outstanding`, RECEPTION],
  ["POST", `/panels/${NO_ID}/settle`, RECEPTION],
  ["GET", "/camps", READERS],
  ["POST", "/camps", [L]],
  ["PATCH", `/camps/${NO_ID}`, [L]],
  ["DELETE", `/camps/${NO_ID}`, [L]],
  ["GET", "/catalog", READERS],
  ["GET", "/catalog/popular", RECEPTION],
  ["POST", "/catalog/changes", RECEPTION],
  ["GET", "/machines/types", RECEPTION],
  ["GET", "/machines", RECEPTION],
  ["POST", "/machines/types", [L]],
  ["POST", "/machines", [L]],
  ["DELETE", `/machines/types/${NO_ID}`, [L]],
  ["DELETE", `/machines/${NO_ID}`, [L]],
  ["GET", "/approvals", [P, L]],
  ["GET", "/approvals/mine", RECEPTION],
  ["POST", `/approvals/${NO_ID}/approve`, [P, L]],
  ["POST", `/approvals/${NO_ID}/reject`, [P, L]],
  ["POST", `/approvals/${NO_ID}/resolve`, [L]],
  ["GET", "/quotations", READERS],
  ["GET", `/quotations/${NO_ID}`, READERS],
  ["POST", "/quotations", RECEPTION],
  ["POST", `/quotations/${NO_ID}/reissue`, RECEPTION],
  ["POST", `/quotations/${NO_ID}/cancel`, RECEPTION],
  ["GET", "/bills", READERS],
  ["GET", "/bills/revisits", RECEPTION],
  ["GET", `/bills/${NO_ID}`, READERS],
  ["POST", "/bills/preview", RECEPTION],
  ["POST", "/bills", RECEPTION],
  ["PATCH", `/bills/${NO_ID}/discount`, RECEPTION],
  ["PATCH", `/bills/${NO_ID}/cancel-items`, RECEPTION],
  ["PATCH", `/bills/${NO_ID}/samples`, RECEPTION],
  ["PATCH", `/bills/${NO_ID}/expected-report`, RECEPTION],
  ["PATCH", `/bills/${NO_ID}/reassign-technician`, [L]],
  ["GET", "/transactions", RECEPTION],
  ["POST", "/transactions", RECEPTION],
  ["PATCH", `/transactions/${NO_ID}`, RECEPTION],
  ["DELETE", `/transactions/${NO_ID}`, RECEPTION],
  ["GET", "/daysheet", READERS],
  ["GET", "/daysheet/users", OVERSIGHT],
  ["GET", "/verify/NOSUCHCODE", READERS],
  ["GET", "/analytics/day-wise", OVERSIGHT],
  ["GET", "/analytics/technician-wise", OVERSIGHT],
  ["GET", "/analytics/location-wise", OVERSIGHT],
  ["GET", "/analytics/referral-wise", OVERSIGHT],
  ["GET", "/analytics/payer-wise", OVERSIGHT],
  ["GET", "/analytics/test-wise", OVERSIGHT],
  ["GET", "/analytics/tally", OVERSIGHT],
  ["GET", "/analytics/patient-outstanding", OVERSIGHT],
  ["GET", `/analytics/patient-daily/${NO_ID}`, OVERSIGHT],
  ["GET", `/analytics/patient-ledger/${NO_ID}`, OVERSIGHT],
];

const ROLE_USER = { technician: "tech1", pathologist: "path1", lead_pathologist: "lead", accountant: "acct", developer: "dev" };

test.describe("API permission matrix", () => {
  test("unauthenticated requests get 401 on every protected endpoint", async () => {
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

  for (const role of [T, P, L, A, D]) {
    test(`${role} is allowed exactly the endpoints in the matrix`, async ({ api, users }) => {
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

  test("unknown /api routes return a JSON 404", async ({ leadApi }) => {
    const { status, body } = await leadApi.raw("GET", "/does-not-exist");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found." });
  });
});
