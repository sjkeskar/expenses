// Patients (pivot.md §4.4): registration with a derived patient number, the
// duplicate block and look-alike warning, and corrections that apply only
// once a pathologist (or the lead) approves them.
const { APPROVERS } = require("../middleware/auth");
const { isValidDateString, getIstDateString, getIstYear } = require("../utils/istDate");
const { identityKey, derivePatientNumber, normalisePhone } = require("../utils/patientNumber");
const { defineApproval, requestApproval } = require("./approvals");

const SEXES = ["male", "female", "other"];
const FIELDS = ["name", "dateOfBirth", "dobIsApproximate", "sex", "phone"];

// The patient's mandatory fields as stored (dateOfBirth as YYYY-MM-DD), for
// comparisons and approval payloads.
function fieldsOf(patient) {
  return {
    name: patient.name,
    dateOfBirth: new Date(patient.dateOfBirth).toISOString().slice(0, 10),
    dobIsApproximate: patient.dobIsApproximate,
    sex: patient.sex,
    phone: patient.phone,
  };
}

// Validates the mandatory fields. Either dateOfBirth (YYYY-MM-DD) or ageYears
// is given; an age is stored as 1 January of the estimated birth year,
// flagged approximate, so the computed age matches what was typed.
function parseFields(body) {
  const name = (body.name || "").trim().replace(/\s+/g, " ");
  if (!name) throw { status: 400, message: "Patient name is required." };
  if (!SEXES.includes(body.sex)) throw { status: 400, message: "sex must be male, female or other." };
  const phone = normalisePhone(body.phone || "");
  if (phone.length !== 10) throw { status: 400, message: "Enter a 10-digit phone number." };

  let dateOfBirth;
  let dobIsApproximate = false;
  if (body.dateOfBirth) {
    if (!isValidDateString(body.dateOfBirth) || body.dateOfBirth > getIstDateString()) {
      throw { status: 400, message: "dateOfBirth must be a past date in YYYY-MM-DD format." };
    }
    dateOfBirth = body.dateOfBirth;
  } else {
    const age = Number(body.ageYears);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw { status: 400, message: "Enter a date of birth or an age in years." };
    dateOfBirth = `${getIstYear() - age}-01-01`;
    dobIsApproximate = true;
  }
  return { name, dateOfBirth, dobIsApproximate, sex: body.sex, phone };
}

const dbFields = (fields) => ({ ...fields, dateOfBirth: new Date(`${fields.dateOfBirth}T00:00:00Z`) });

// A number is taken if another patient holds it, now or as an old number.
async function numberTaken(tx, number, patientId) {
  const holder = await tx.patient.findUnique({ where: { patientNumber: number }, select: { id: true } });
  const alias = await tx.patientNumberAlias.findUnique({ where: { number }, select: { patientId: true } });
  return Boolean((holder && holder.id !== patientId) || (alias && alias.patientId !== patientId));
}

// Same phone, same sex, birth year within one: most likely the same person
// entered with different details (a spelling variant, or an age given a
// year later), which the identity key can't catch. A family member sharing
// the phone usually differs in sex or age; twins can be confirmed distinct.
async function lookalikes(tx, fields) {
  const year = Number(fields.dateOfBirth.slice(0, 4));
  return tx.patient.findMany({
    where: {
      phone: fields.phone,
      sex: fields.sex,
      dateOfBirth: { gte: new Date(`${year - 1}-01-01T00:00:00Z`), lte: new Date(`${year + 1}-12-31T00:00:00Z`) },
    },
    select: { id: true, patientNumber: true, name: true, dateOfBirth: true, sex: true, phone: true },
  });
}

// Registers a patient. Someone who already exists (same identity key) is
// returned instead — duplicates can't be entered, even by two technicians
// at the same moment: the unique index settles that race.
async function registerPatient(tx, body) {
  const fields = parseFields(body);
  const key = identityKey(fields);
  const existing = await tx.patient.findUnique({ where: { identityKey: key } });
  if (existing) return { patient: existing, existed: true };

  if (!body.confirmedDistinct) {
    const similar = await lookalikes(tx, fields);
    if (similar.length) {
      throw { status: 409, message: "This may be a patient who is already registered.", details: { lookalikes: similar } };
    }
  }
  const patientNumber = await derivePatientNumber(key, (number) => numberTaken(tx, number));
  const patient = await tx.patient.create({ data: { ...dbFields(fields), identityKey: key, patientNumber } });
  return { patient, existed: false };
}

// Refuses details that would make this patient identical to someone else.
async function assertNotDuplicate(tx, key, patientId) {
  const other = await tx.patient.findUnique({ where: { identityKey: key }, select: { id: true, patientNumber: true, name: true } });
  if (other && other.id !== patientId) {
    throw { status: 409, message: `These details belong to another patient (${other.name}, ${other.patientNumber}).`, details: { patient: other } };
  }
}

async function lockPatient(tx, patientId) {
  await tx.$queryRaw`SELECT 1 FROM "patients" WHERE "id" = ${patientId} FOR UPDATE`;
  const patient = await tx.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw { status: 404, message: "Patient not found." };
  return patient;
}

// Proposes a correction to the mandatory fields. One may be pending per
// patient at a time; a pathologist's or the lead's applies at once.
async function proposeCorrection(tx, patientId, body, user) {
  const patient = await lockPatient(tx, patientId);
  const from = fieldsOf(patient);
  const merged = { ...from, ...body };
  if (body.ageYears !== undefined && body.dateOfBirth === undefined) delete merged.dateOfBirth;
  const to = parseFields(merged);
  // A carried-over DOB keeps its approximate flag (parseFields would treat it as exact).
  if (body.dateOfBirth === undefined && body.ageYears === undefined) to.dobIsApproximate = from.dobIsApproximate;
  if (FIELDS.every((f) => from[f] === to[f])) throw { status: 400, message: "Nothing changed." };
  await assertNotDuplicate(tx, identityKey(to), patientId);

  const pending = await tx.approval.count({ where: { subjectType: "patient_correction", subjectId: patientId, status: "pending" } });
  if (pending) throw { status: 409, message: "A correction for this patient is already waiting for approval." };
  return requestApproval(tx, { subjectType: "patient_correction", subjectId: patientId, payload: { from, to } }, user);
}

// Applies an approved correction: re-derives the number (the old one stays
// searchable as an alias, since printouts can't be updated) and audits each
// changed field. Bills read the patient live, so they show the change at once.
async function applyCorrection(tx, approval, approver) {
  const patient = await lockPatient(tx, approval.subjectId);
  const { to } = approval.payload;
  const key = identityKey(to);
  await assertNotDuplicate(tx, key, patient.id);

  const patientNumber = await derivePatientNumber(key, (number) => numberTaken(tx, number, patient.id));
  if (patientNumber !== patient.patientNumber) {
    await tx.patientNumberAlias.deleteMany({ where: { patientId: patient.id, number: patientNumber } });
    await tx.patientNumberAlias.create({ data: { patientId: patient.id, number: patient.patientNumber } });
  }
  await tx.patient.update({ where: { id: patient.id }, data: { ...dbFields(to), identityKey: key, patientNumber } });

  const from = fieldsOf(patient);
  const changed = FIELDS.filter((f) => from[f] !== to[f]);
  await tx.patientChange.createMany({
    data: changed.map((field) => ({
      patientId: patient.id,
      field,
      oldValue: String(from[field]),
      newValue: String(to[field]),
      changedById: approval.requestedById,
      approvedById: approver.id,
    })),
  });
}

defineApproval("patient_correction", { approvers: APPROVERS, onApprove: applyCorrection });

module.exports = { parseFields, fieldsOf, registerPatient, proposeCorrection };
