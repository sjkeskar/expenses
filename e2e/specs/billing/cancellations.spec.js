// Cancelling tests, partial refunds and their approvals (pivot.md §4.10).
const { test, expect } = require("../../fixtures");
const { db } = require("../../helpers/db");

test.describe("Cancelling tests", () => {
  test("cancelling one test refunds what was collected beyond the new net amount", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    const after = await techApi.cancel(bill, ["CBC"], { refundMode: "cash" });
    expect(after).toMatchObject({ originalAmount: "100", netAmount: "100", balance: "0", status: "fully_paid" });
    expect(after.refunds).toEqual([expect.objectContaining({ amount: "300", mode: "cash" })]);
    expect(after.items.find((i) => i.code === "CBC").status).toBe("cancelled");
    expect(after.holds).toEqual(["Cancellation awaiting approval"]);
  });

  test("no refund is due when less was collected than the new net amount", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 50, mode: "cash" } });
    const after = await techApi.cancel(bill, ["GLUF"]);
    expect(after).toMatchObject({ originalAmount: "300", balance: "250", refunds: [] });
  });

  test("a refund needs a mode, and a cancellation needs a reason", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    const itemIds = [bill.items.find((i) => i.code === "CBC").id];
    const noMode = await techApi.raw("PATCH", `/bills/${bill.id}/cancel-items`, { itemIds, reason: "x" });
    expect(noMode.body.error).toMatch(/300\.00 must be refunded/);
    const noReason = await techApi.raw("PATCH", `/bills/${bill.id}/cancel-items`, { itemIds, refundMode: "cash" });
    expect(noReason.body.error).toMatch(/needs a reason/);
  });

  test("the discount defaults to what still fits the new subtotal", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], discountAmount: 250 });
    const after = await techApi.cancel(bill, ["CBC"]);
    expect(after).toMatchObject({ originalAmount: "100", discountAmount: "100", netAmount: "0" });
  });

  test("cancelling every item cancels the bill and refunds everything", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "LIPID"], initialPayment: { amount: 300, mode: "upi" } });
    const after = await techApi.cancel(bill, ["CBC", "LIPID"], { refundMode: "upi" });
    expect(after).toMatchObject({ status: "cancelled", originalAmount: "0", balance: "0" });
    expect(after.refunds[0].amount).toBe("300");
    const pay = await techApi.raw("POST", "/transactions", { billId: bill.id, amountCollected: 1, mode: "cash" });
    expect(pay.body.error).toMatch(/cancelled/);
  });

  test("a test that has started processing can't be cancelled", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    const cbc = bill.items.find((i) => i.code === "CBC");
    await db().billItem.update({ where: { id: cbc.id }, data: { processingStatus: "in_progress" } });
    const { status, body } = await techApi.raw("PATCH", `/bills/${bill.id}/cancel-items`, { itemIds: [cbc.id], reason: "x" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/CBC has already started processing/);
  });

  test("an item can only be cancelled once", async ({ techApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    await techApi.cancel(bill, ["GLUF"]);
    const { status } = await techApi.raw("PATCH", `/bills/${bill.id}/cancel-items`, {
      itemIds: [bill.items.find((i) => i.code === "GLUF").id], reason: "again",
    });
    expect(status).toBe(400);
  });

  test("a cancelled test drops out of the revisit list", async ({ techApi }) => {
    const gtt = await db().catalogItem.findUnique({ where: { code: "GTT" } });
    const bill = await techApi.createBill({
      items: ["GTT", "CBC"],
      pendingDraws: [{ catalogItemId: gtt.id, testId: gtt.id, sequence: 2, dueAt: "2026-12-01T09:00:00+05:30" }],
    });
    await techApi.cancel(bill, ["GTT"]);
    const { collections } = await techApi.call("GET", "/bills/revisits");
    expect(collections.some((c) => c.billItem.bill.id === bill.id)).toBe(false);
  });
});

test.describe("Cancellation approvals", () => {
  test("approval lifts the hold; a pathologist's own cancellation is self-approved", async ({ techApi, api, users }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"] });
    await techApi.cancel(bill, ["GLUF"]);
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_cancellation" });
    expect(approval.payload).toEqual({ items: ["GLUF"], refund: "0.00" });
    await (await api(users.path1)).decide(approval.id, "approve");
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);

    const path = await api(users.path1);
    const own = await path.createBill({ items: ["CBC", "GLUF"] });
    expect((await path.cancel(own, ["GLUF"])).holds).toEqual([]);
  });

  test("a rejected cancellation holds the report until the lead marks it resolved", async ({ techApi, api, users, leadApi }) => {
    const bill = await techApi.createBill({ items: ["CBC", "GLUF"], initialPayment: { amount: 400, mode: "cash" } });
    await techApi.cancel(bill, ["GLUF"], { refundMode: "cash" });
    const approval = await techApi.approvalFor({ billId: bill.id, subjectType: "bill_cancellation" });
    await (await api(users.path1)).decide(approval.id, "reject", "Test was wanted");

    const held = await techApi.getBill(bill.id);
    expect(held.holds).toEqual(["Cancellation rejected: awaiting the lead"]);
    expect(held.refunds).toHaveLength(1); // the refund already happened and stands

    const queue = await leadApi.call("GET", "/approvals");
    expect(queue.approvals.map((a) => a.id)).toContain(approval.id);
    const noNote = await leadApi.raw("POST", `/approvals/${approval.id}/resolve`, {});
    expect(noNote.status).toBe(400);
    await leadApi.call("POST", `/approvals/${approval.id}/resolve`, { note: "Re-billed on a new bill" });
    expect((await techApi.getBill(bill.id)).holds).toEqual([]);
  });
});
