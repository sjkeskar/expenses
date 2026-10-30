// Centralized helpers for the "IST only" rule (see README). All of these
// treat India Standard Time (Asia/Kolkata, fixed UTC+5:30, no DST) as the
// one true calendar — never the server OS's or database's timezone.

// 'DDMMYYYY' for the IST calendar day of the given instant (defaults to
// now). Used as the bill_number date prefix when no explicit bill date is
// given.
function getIstDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;
  return `${lookup.day}${lookup.month}${lookup.year}`;
}

// 'YYYY-MM-DD' for the IST calendar day of the given instant (defaults to
// now). Matches the format an <input type="date"> sends/expects, so it's
// used as the default value for date pickers (bill date, analytics range).
function getIstDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  return formatter.format(date); // en-CA gives YYYY-MM-DD directly
}

const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_STRING_REGEX.test(value)) return false;
  // Reject calendar-invalid dates like 2026-02-30 by round-tripping.
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === m - 1 &&
    check.getUTCDate() === d
  );
}

// 2-digit location code + 'YY' + 'MM' -> e.g. "04" + "2026-09-15" -> "042609".
// This is the BillCounter key (and bill_number prefix) — the sequence
// counter is scoped to exactly what appears in the printed bill number, so
// no two bills ever collide. Pure string reformatting for
// the date part — no timezone math needed, since dateString is already
// an IST calendar date, not an instant.
function buildBillCounterKey(locationCode, dateString) {
  const year = dateString.slice(0, 4);
  const month = dateString.slice(5, 7);
  const yy = year.slice(2, 4);
  return `${locationCode}${yy}${month}`;
}

// Combines a chosen IST calendar date with the CURRENT wall-clock time
// (also read in IST) into one absolute instant. This is what lets a
// backdated/postdated bill still sort correctly against same-day entries
// by time, while its calendar day (for bill numbering and analytics
// bucketing) matches the date the operator picked, not today's date.
function combineDateWithCurrentIstTime(dateString) {
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = timeFormatter.formatToParts(now);
  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;
  // Intl can format midnight as "24:00" for hour12:false — normalize it.
  const hour = lookup.hour === "24" ? "00" : lookup.hour;
  const timeString = `${hour}:${lookup.minute}:${lookup.second}`;
  return new Date(`${dateString}T${timeString}+05:30`);
}

// Parses an API date-time (ISO 8601 with an explicit offset, e.g.
// "2026-10-27T09:30:00+05:30", which is what the frontend's lib/ist.ts
// sends) into a Date. A value without an offset is refused rather than
// guessed at: it would be read in the server's timezone, never IST.
// Returns null for empty input; throws { status: 400 } for anything else invalid.
const OFFSET_REGEX = /(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (typeof value !== "string" || !OFFSET_REGEX.test(value) || Number.isNaN(date.getTime())) {
    throw { status: 400, message: `${field} must be a date-time with a timezone offset (e.g. 2026-10-27T09:30:00+05:30).` };
  }
  return date;
}

// The IST calendar year of an instant.
function getIstYear(date = new Date()) {
  return Number(getIstDateString(date).slice(0, 4));
}

// Whole years of age on the IST calendar day of `on`, for a date-only DOB.
function ageOn(dateOfBirth, on = new Date()) {
  const [y, m, d] = getIstDateString(on).split("-").map(Number);
  const dob = new Date(dateOfBirth);
  const hadBirthday = m > dob.getUTCMonth() + 1 || (m === dob.getUTCMonth() + 1 && d >= dob.getUTCDate());
  return y - dob.getUTCFullYear() - (hadBirthday ? 0 : 1);
}

module.exports = {
  getIstDateKey,
  getIstDateString,
  isValidDateString,
  buildBillCounterKey,
  combineDateWithCurrentIstTime,
  parseInstant,
  getIstYear,
  ageOn,
};
