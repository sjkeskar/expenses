const { getIstDateKey } = require("./istDate");

// Generates bill numbers in the confirmed format: DDMMYYYY + 5-digit
// sequence, no separator (e.g. 2408202600001), where the 5-digit sequence
// resets to 00001 at the start of each calendar day (IST — see istDate.js).
//
// `dateKey` is the 'DDMMYYYY' string for the bill's OWN date (which may be
// backdated/postdated — bills can be created for any date, defaulting to
// today). It's the caller's job to pass the right key (see bills.js),
// derived from the operator-chosen bill date, not necessarily "now."
// If omitted, defaults to today's IST date, preserving old behavior.
//
// IMPORTANT: pass the `tx` (transaction client) you're already using to
// create the Bill row, not the top-level `prisma` client. Prisma's upsert
// is atomic at the DB level (ON CONFLICT ... DO UPDATE), so running this
// inside the same transaction as the Bill insert guarantees no two
// operators ever get the same bill_number for the same date, even with
// 6+ concurrent users.
async function generateBillNumber(tx, dateKey) {
  const resolvedDateKey = dateKey || getIstDateKey(new Date());

  const counter = await tx.billCounter.upsert({
    where: { dateKey: resolvedDateKey },
    update: { lastSequence: { increment: 1 } },
    create: { dateKey: resolvedDateKey, lastSequence: 1 },
  });

  const sequence = String(counter.lastSequence).padStart(5, "0");
  return `${resolvedDateKey}${sequence}`;
}

module.exports = { generateBillNumber };
