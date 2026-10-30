// Patient identity and numbers (pivot.md §4.4).
//
// identityKey is the normalised "NAME|DOB|SEX|PHONE". Its unique index is
// what makes a duplicate patient impossible to enter. The patient number
// is derived from it: 12 digits from a SHA-256 of the key plus a Luhn check
// digit (13 digits, no letters). The same details therefore always give
// the same number, and the number reveals nothing about the patient.
const crypto = require("crypto");

const BODY_SPACE = 10n ** 12n;

// Upper-case, punctuation dropped, single spaces. Letters of any script survive.
function normaliseName(name) {
  return String(name)
    .toUpperCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Digits only, last 10 (drops a +91 or leading 0).
function normalisePhone(phone) {
  return String(phone).replace(/\D/g, "").slice(-10);
}

// An approximate DOB (entered as an age) counts as its birth year only.
function identityKey({ name, dateOfBirth, dobIsApproximate, sex, phone }) {
  const dob = new Date(dateOfBirth).toISOString().slice(0, dobIsApproximate ? 4 : 10);
  return [normaliseName(name), dob, sex, normalisePhone(phone)].join("|");
}

// Luhn check digit for a digit string: doubles every second digit from the right.
function luhnDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

function withCheckDigit(body) {
  const digits = body.toString().padStart(12, "0");
  return digits + luhnDigit(digits);
}

function isValidPatientNumber(number) {
  return /^\d{13}$/.test(number) && luhnDigit(number.slice(0, 12)) === number[12];
}

// Derives the number for an identity key. Two different people can, rarely,
// hash to the same 12 digits: `isTaken(number)` reports that, and the next
// free body is used instead (that one patient's number is then not derivable).
async function derivePatientNumber(key, isTaken) {
  const hash = crypto.createHash("sha256").update(key).digest();
  for (let body = hash.readBigUInt64BE(0) % BODY_SPACE; ; body = (body + 1n) % BODY_SPACE) {
    const number = withCheckDigit(body);
    if (!(await isTaken(number))) return number;
  }
}

module.exports = { normaliseName, normalisePhone, identityKey, derivePatientNumber, isValidPatientNumber };
