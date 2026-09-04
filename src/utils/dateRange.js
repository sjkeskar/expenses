// Parses optional ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD query params into
// concrete [from, to) bounds. If either is missing, defaults to "everything"
// on that side, so callers can always apply the filter unconditionally
// instead of building dynamic SQL.
//
// IMPORTANT: dates are interpreted as India Standard Time (UTC+5:30, fixed
// offset, no DST) calendar days, not the server's local timezone. Without
// the explicit "+05:30" below, `new Date("2026-08-26T00:00:00")` would be
// parsed in whatever timezone the Node process happens to be running in —
// if that's UTC, "midnight on the 26th" would actually mean 5:30 AM IST on
// the 26th, silently excluding the first 5.5 hours of that business day.
//
// `to` is exclusive and pushed to the start of the day AFTER endDate (also
// in IST), so selecting endDate = a given day includes all transactions
// on that day.
function parseDateRange(query) {
  const { startDate, endDate } = query;

  const from = startDate ? new Date(`${startDate}T00:00:00+05:30`) : new Date(0);

  let to;
  if (endDate) {
    const endOfDayStart = new Date(`${endDate}T00:00:00+05:30`);
    to = new Date(endOfDayStart.getTime() + 24 * 60 * 60 * 1000);
  } else {
    // "Tomorrow" — safely includes anything up to right now.
    to = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  return { from, to };
}

module.exports = { parseDateRange };
