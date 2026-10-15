// Small pure helpers shared by specs and page objects.
const crypto = require("crypto");

// Unique, human-readable name for throwaway records, so parallel specs
// never collide and never depend on each other's data.
function uid(prefix = "e2e") {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

// Mirrors formatCurrency() in public/js/common.js.
function inr(value) {
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 'YYYY-MM-DD' for the IST calendar day of the given instant.
function istDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

// 'DD/MM/YYYY' — mirrors formatDate() in common.js for a YYYY-MM-DD string.
function displayDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-");
  return `${d}/${m}/${y}`;
}

// Expected bill-number prefix: {locationCode}{YY}{MM}.
function billPrefix(locationCode, yyyyMmDd) {
  return `${locationCode}${yyyyMmDd.slice(2, 4)}${yyyyMmDd.slice(5, 7)}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { uid, inr, istDate, displayDate, billPrefix, escapeRegex };
