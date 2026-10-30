// Approvals (pivot.md §4.2): one table, one queue.
//
// Each subject type is defined by the service that owns it (billing,
// catalog, patients, doctors) through defineApproval(): who may approve it,
// and what approving or rejecting does. That keeps every rule next to the
// data it changes and keeps this module free of circular requires.
const SUBJECTS = {};

function defineApproval(subjectType, { approvers, onApprove = async () => {}, onReject = async () => {} }) {
  SUBJECTS[subjectType] = { approvers, onApprove, onReject };
}

function canReview(subjectType, user) {
  return SUBJECTS[subjectType].approvers.includes(user.role);
}

// The subject types a user may review, for filtering the queue.
function reviewableBy(user) {
  return Object.keys(SUBJECTS).filter((subjectType) => canReview(subjectType, user));
}

// Records a request. When the requester may approve this kind of request
// themselves (a pathologist's own discount, the lead's own catalog change,
// …) it is recorded as self-approved and takes effect at once.
async function requestApproval(tx, { subjectType, subjectId = null, billId = null, payload = null }, user) {
  const self = canReview(subjectType, user);
  const approval = await tx.approval.create({
    data: {
      subjectType,
      subjectId,
      billId,
      payload,
      requestedById: user.id,
      ...(self && { status: "approved", selfApproved: true, reviewedById: user.id, reviewedAt: new Date() }),
    },
  });
  if (self) await SUBJECTS[subjectType].onApprove(tx, approval, user);
  return approval;
}

// Locks an approval for review. Its bill (if any) is locked first: billing
// locks bill → approval too, so the two paths can never deadlock.
async function lockApproval(tx, approvalId) {
  const peek = await tx.approval.findUnique({ where: { id: approvalId }, select: { billId: true } });
  if (!peek) throw { status: 404, message: "Request not found." };
  if (peek.billId) await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${peek.billId} FOR UPDATE`;
  await tx.$queryRaw`SELECT 1 FROM "approvals" WHERE "id" = ${approvalId} FOR UPDATE`;
  return tx.approval.findUnique({ where: { id: approvalId } });
}

// decision: "approve" | "reject". Locked, so two reviewers acting at once
// can't both decide: the second gets a 409.
async function review(tx, approvalId, decision, note, user) {
  const approval = await lockApproval(tx, approvalId);
  if (approval.status !== "pending") throw { status: 409, message: "This request has already been reviewed." };
  if (!canReview(approval.subjectType, user)) throw { status: 403, message: "You can't review this kind of request." };

  const { onApprove, onReject } = SUBJECTS[approval.subjectType];
  await (decision === "approve" ? onApprove : onReject)(tx, approval, user);
  return tx.approval.update({
    where: { id: approval.id },
    data: {
      status: decision === "approve" ? "approved" : "rejected",
      reviewedById: user.id,
      reviewedAt: new Date(),
      reviewNote: note || null,
    },
  });
}

// A rejected cancellation keeps the bill's report on hold until the lead
// deals with it (e.g. by re-billing the test) and marks it resolved.
async function resolve(tx, approvalId, note, user) {
  const approval = await lockApproval(tx, approvalId);
  if (approval.subjectType !== "bill_cancellation" || approval.status !== "rejected") {
    throw { status: 409, message: "Only a rejected cancellation can be marked resolved." };
  }
  if (!note || !note.trim()) throw { status: 400, message: "Say how it was resolved." };
  return tx.approval.update({
    where: { id: approval.id },
    data: { status: "resolved", resolvedById: user.id, resolvedAt: new Date(), resolveNote: note.trim() },
  });
}

module.exports = { defineApproval, reviewableBy, requestApproval, review, resolve };
