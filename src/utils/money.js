// Integer-paise money maths (see bugs/Closed/BUG-008).
//
// Every amount column in the schema is Decimal(12,2) — rupees with exactly
// two decimal places. Prisma hands those back as Decimal objects, and the
// routes used to do `Number(...)` on them and compare the resulting
// floats directly. That is wrong for the obvious reason: 0.1 + 0.2 is
// 0.30000000000000004 in binary floating point, so "collect 0.10 + 0.20
// against a 0.30 balance" was rejected as an overpayment, and the error
// message quoted the 0.30000000000000004 back at the operator.
//
// The fix is to leave float arithmetic entirely: convert at the boundary
// (read a Decimal -> go straight to integer paise), do all the adding,
// subtracting and comparing on integers, and convert back only to write
// or to display. Integers in that range are exact, so the comparisons
// are too.
//
// toPaise's own multiplication is safe: at Decimal(12,2) magnitudes the
// binary error in e.g. `0.30 * 100` is many orders of magnitude below
// 0.5, so Math.round always lands on the intended integer. The bug was
// never in the multiplication — only in comparing unrounded floats.
//
// Inputs with more than two decimals (100.456) round to the nearest
// paisa, which matches what Postgres already did when storing them into
// a Decimal(12,2) column, so storage behaviour is unchanged.

// 0.30 (number, string, or a Prisma Decimal) -> 30
const toPaise = (v) => Math.round(Number(v) * 100);

// 30 -> "0.30". A string, deliberately: Prisma accepts it for a Decimal
// column without a float ever being involved, and it is also the right
// form to interpolate into an error message shown to an operator.
const fromPaise = (p) => (p / 100).toFixed(2);

module.exports = { toPaise, fromPaise };
