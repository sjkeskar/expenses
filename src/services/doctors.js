// Referring doctors (pivot.md §4.5). Technicians and pathologists add them
// on the Doctors screen; a new doctor is usable on bills at once, but holds
// those bills' reports until the lead approves. A rejected doctor is dropped
// from every bill and open quotation naming them (the referral stays
// "doctor", with no doctor named), recorded in each bill's history.
const { LEAD } = require("../middleware/auth");
const { defineApproval, requestApproval } = require("./approvals");

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

async function addDoctor(tx, body, user) {
  const name = text(body.name);
  if (!name) throw { status: 400, message: "Doctor's name is required." };
  const doctor = await tx.referringDoctor.create({
    data: { name, phone: text(body.phone), clinic: text(body.clinic), createdById: user.id },
  });
  await requestApproval(tx, { subjectType: "referring_doctor", subjectId: doctor.id }, user);
  return tx.referringDoctor.findUnique({ where: { id: doctor.id } });
}

defineApproval("referring_doctor", {
  approvers: LEAD,
  onApprove: (tx, approval) => tx.referringDoctor.update({ where: { id: approval.subjectId }, data: { status: "approved" } }),
  onReject: async (tx, approval, user) => {
    const doctorId = approval.subjectId;
    await tx.referringDoctor.update({ where: { id: doctorId }, data: { status: "rejected" } });
    const bills = await tx.bill.findMany({ where: { referringDoctorId: doctorId }, select: { id: true } });
    await tx.billEvent.createMany({
      data: bills.map((b) => ({ billId: b.id, kind: "doctor_dropped", detail: { doctorId }, createdById: user.id })),
    });
    await tx.bill.updateMany({ where: { referringDoctorId: doctorId }, data: { referringDoctorId: null } });
    await tx.quotation.updateMany({ where: { referringDoctorId: doctorId, status: "open" }, data: { referringDoctorId: null } });
  },
});

module.exports = { addDoctor };
