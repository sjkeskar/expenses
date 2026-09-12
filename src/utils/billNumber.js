// Generates bill numbers in the format: {locationCode}{YY}{MM}{seq}
// — e.g. "0426090042" for location code "04", year 2026, month 09,
// sequence 0042. No separators. `seq` is 4 digits (0000-9999), starts at
// 0000 for the first bill in a given (locationCode, YY, MM) combination,
// and resets to 0000 at the start of each new month for that code.
//
// `counterKey` (built by buildBillCounterKey in istDate.js) is required
// — there's no "default to today" fallback anymore, since the key now
// depends on the bill's location, which the caller must always resolve
// first (see bills.js).
//
// IMPORTANT: pass the `tx` (transaction client) you're already using to
// create the Bill row, not the top-level `prisma` client. Prisma's upsert
// is atomic at the DB level (ON CONFLICT ... DO UPDATE), so running this
// inside the same transaction as the Bill insert guarantees no two
// operators ever get the same bill_number for the same location-code and
// month, even with 6+ concurrent users — including when multiple
// locations deliberately share the same code (confirmed decision).
const MAX_SEQUENCE = 9999;

async function generateBillNumber(tx, counterKey) {
  if (!counterKey) {
    throw new Error("generateBillNumber requires a counterKey (locationCode + YY + MM).");
  }

  const counter = await tx.billCounter.upsert({
    where: { counterKey },
    update: { lastSequence: { increment: 1 } },
    create: { counterKey, lastSequence: 0 },
  });

  if (counter.lastSequence > MAX_SEQUENCE) {
    throw {
      status: 500,
      message:
        "Monthly bill sequence limit (9999) reached for this location code. Contact your developer/admin.",
    };
  }

  const sequence = String(counter.lastSequence).padStart(4, "0");
  return `${counterKey}${sequence}`;
}

module.exports = { generateBillNumber };
