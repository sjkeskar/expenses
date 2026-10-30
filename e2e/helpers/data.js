// Small pure helpers shared by specs and page objects.
const crypto = require("crypto");

// Unique, human-readable name for throwaway records, so parallel specs
// never collide and never depend on each other's data.
function uid(prefix = "e2e") {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

// A random 10-digit mobile number, so parallel specs never share a phone
// (a shared phone + sex + age would trip the patient look-alike check).
function phone() {
  return `9${crypto.randomInt(0, 1e9).toString().padStart(9, "0")}`;
}

// An IST wall-clock time as the API expects it: "2026-10-27T09:30:00+05:30".
function ist(yyyyMmDd, hhMm = "09:00") {
  return `${yyyyMmDd}T${hhMm}:00+05:30`;
}

// 'YYYY-MM-DD' for the IST calendar day of the given instant.
function istDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

// Expected bill-number prefix: {locationCode}{YY}{MM}.
function billPrefix(locationCode, yyyyMmDd) {
  return `${locationCode}${yyyyMmDd.slice(2, 4)}${yyyyMmDd.slice(5, 7)}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { uid, phone, ist, istDate, billPrefix, escapeRegex };
