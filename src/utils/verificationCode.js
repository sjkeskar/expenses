// Random, unguessable code printed as a Code 128 barcode on quotations and
// bills (pivot.md §7.3) — deliberately not the sequential document number.
// Upper-case letters and digits without look-alikes (0/O, 1/I), so the
// readable text under the barcode can be typed in if a scan fails. The
// 32-character alphabet divides 256 exactly, so every character is equally likely.
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateVerificationCode(length = 12) {
  return Array.from(crypto.randomBytes(length), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

module.exports = { generateVerificationCode };
