// The lead pathologist (pivot.md §3.3): exactly one at a time.
//
// Every change of lead goes through appointLead(), which first locks the
// single lab_settings row. Two hand-overs (or a hand-over racing the
// developer's re-appointment) therefore run one after the other, and each
// sees the lead the previous one left behind — there is never a moment
// with two leads or none.
const INACTIVE_DAYS = 7;

async function currentLead(tx) {
  return tx.user.findFirst({ where: { role: "lead_pathologist", isDeleted: false } });
}

// The open term's start counts as activity too: a lead appointed today who
// hasn't signed in yet isn't "inactive".
async function lastActivity(tx, lead) {
  const term = await tx.leadTerm.findFirst({ where: { userId: lead.id, endedAt: null } });
  return new Date(Math.max(lead.lastLoginAt?.getTime() ?? 0, term?.startedAt.getTime() ?? 0));
}

async function isLeadInactive(tx, lead) {
  return Date.now() - (await lastActivity(tx, lead)).getTime() > INACTIVE_DAYS * 24 * 60 * 60 * 1000;
}

// Makes `pathologistId` the lead; the current lead becomes a pathologist
// (keeping their history). reason: "handover" | "inactive_lead".
async function appointLead(tx, pathologistId, reason, appointedBy) {
  const locked = await tx.$queryRaw`SELECT 1 FROM "lab_settings" WHERE "id" = 1 FOR UPDATE`;
  if (!locked.length) throw { status: 409, message: "The lab hasn't been set up yet." };

  const target = await tx.user.findUnique({ where: { id: pathologistId || "" } });
  if (!target || target.isDeleted || target.role !== "pathologist") {
    throw { status: 400, message: "Choose an active pathologist." };
  }
  const lead = await currentLead(tx);
  // Re-checked under the lock: two hand-overs sent at once both pass the
  // role check at the door, but only the first is still from the lead.
  if (reason === "handover" && lead?.id !== appointedBy.id) {
    throw { status: 403, message: "You are no longer the lead pathologist." };
  }
  if (reason === "inactive_lead" && lead && !(await isLeadInactive(tx, lead))) {
    throw { status: 409, message: `The lead can be re-appointed only after ${INACTIVE_DAYS} days without signing in.` };
  }

  const now = new Date();
  if (lead) {
    await tx.user.update({ where: { id: lead.id }, data: { role: "pathologist" } });
    await tx.leadTerm.updateMany({ where: { userId: lead.id, endedAt: null }, data: { endedAt: now } });
  }
  await tx.user.update({ where: { id: target.id }, data: { role: "lead_pathologist" } });
  await tx.leadTerm.create({ data: { userId: target.id, startedAt: now, reason, appointedById: appointedBy.id } });
  return target;
}

module.exports = { INACTIVE_DAYS, currentLead, lastActivity, isLeadInactive, appointLead };
