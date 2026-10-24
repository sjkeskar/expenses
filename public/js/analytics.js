// Analytics UI shared by accountant.html and admin.html's Analytics tab,
// which carry identical markup and element ids. The page calls
// initAnalytics() once, then loadAnalytics() whenever the view is shown.

// The five summary tables, each defined once here. A definition drives the
// on-screen table (#{path}-table), its own PDF button (#download-{path}-pdf)
// and its section of "Download All", so screen and PDF can't drift apart.
// `dated` summaries respect the date range; the other is a current snapshot.
const SUMMARIES = [
  {
    path: "day-wise", key: "dayWise", title: "Day-wise Summary", file: "day-wise-summary", dated: true,
    headers: ["Day", "Total Collected", "Transactions", "Cash", "Credit Card", "UPI", "Bills Refunded"],
    cells: (r) => [
      formatDate(r.day),
      formatCurrency(r.total_collected),
      r.transaction_count,
      `${r.cash_count} (${formatCurrency(r.cash_total)})`,
      `${r.credit_card_count} (${formatCurrency(r.credit_card_total)})`,
      `${r.upi_count} (${formatCurrency(r.upi_total)})`,
      r.refunded_bill_count ? `${r.refunded_bill_count} (${formatCurrency(r.refunded_amount_total)})` : "—",
    ],
  },
  {
    path: "operator-wise", key: "operatorWise", title: "Operator-wise Summary", file: "operator-wise-summary", dated: true,
    headers: ["Operator", "Total Billed", "Discount Given", "Amount Collected", "Outstanding Balance", "Bills Created", "Payments Taken"],
    cells: (r) => [
      r.operatorName,
      formatCurrency(r.totalBilled || 0),
      formatCurrency(r.totalDiscount || 0),
      formatCurrency(r.totalCollected || 0),
      formatCurrency(r.totalPending || 0),
      r.billsCreated || 0,
      r.transactionCount || 0,
    ],
  },
  {
    path: "location-wise", key: "locationWise", title: "Location-wise Summary", file: "location-wise-summary", dated: true,
    headers: ["Location", "Total Billed", "Discount Given", "Pending Amount", "Bills Created"],
    cells: (r) => [
      r.location_name,
      formatCurrency(r.total_billed || 0),
      formatCurrency(r.total_discount || 0),
      formatCurrency(r.total_pending || 0),
      r.bills_created || 0,
    ],
  },
  {
    path: "category-wise", key: "categoryWise", title: "Category-wise Summary", file: "category-wise-summary", dated: true,
    headers: ["Category", "Behavior", "Bills", "Total Billed", "Discount Given", "Outstanding Balance"],
    cells: (r) => [
      r.category_name,
      r.category_type || "—",
      r.bill_count || 0,
      formatCurrency(r.total_billed || 0),
      formatCurrency(r.total_discount || 0),
      formatCurrency(r.total_outstanding || 0),
    ],
  },
  {
    path: "client-outstanding", key: "clientOutstanding", title: "Client Outstanding Balances", file: "client-outstanding", dated: false,
    headers: ["Client", "Outstanding Balance", "Pending Bills"],
    cells: (r) => [r.client_name, formatCurrency(r.outstanding_balance), r.pending_bill_count],
  },
];

// Per-Client Detail: the two tables for the client picked in its combobox.
const CLIENT_DAILY = {
  headers: ["Day", "Total Collected", "Transactions"],
  cells: (r) => [formatDate(r.day), formatCurrency(r.total_collected), r.transaction_count],
};
const CLIENT_LEDGER = {
  headers: ["Bill #", "Net Amount", "Balance", "Status", "Payments"],
  cells: (b) => [
    b.billNumber,
    formatCurrency(b.netAmount),
    formatCurrency(b.balance),
    statusCell(b.status),
    b.transactions
      .map((t) => `${formatCurrency(t.amountCollected)}${Number(t.discountAmount) > 0 ? ` + ${formatCurrency(t.discountAmount)} discount` : ""} (${t.mode}, ${t.operator.name})`)
      .join("; ") || "—",
  ],
};

// Rows from the last successful load, so the Download PDF buttons export
// exactly what's on screen (respecting the active date range) without a
// fresh API call. `ledger.name` is only set once a client's detail loaded.
const lastRows = {}; // summary path -> rows
let ledgerClient = null; // picked in Per-Client Detail
let ledger = { name: "", daily: [], bills: [] };

function initAnalytics() {
  comboboxById("ledger-client", {
    lookup: "clients",
    renderLabel: (c) => c.name,
    onSelect: (client) => {
      ledgerClient = client;
      loadClientDetail();
    },
  });
  setupDateRange();
  setupAnalyticsDownloads();
}

async function loadAnalytics() {
  const qs = buildDateParams();
  const results = await Promise.all(SUMMARIES.map((s) => api(`/analytics/${s.path}${s.dated ? qs : ""}`)));
  SUMMARIES.forEach((s, i) => {
    lastRows[s.path] = results[i][s.key];
    renderTableRows(`${s.path}-table`, lastRows[s.path].map(s.cells));
  });
  await loadClientDetail();
}

async function loadClientDetail() {
  if (!ledgerClient) return;
  const qs = buildDateParams();
  const [daily, history] = await Promise.all([
    api(`/analytics/client-daily/${ledgerClient.id}${qs}`),
    api(`/analytics/client-ledger/${ledgerClient.id}`),
  ]);
  ledger = { name: ledgerClient.name, daily: daily.clientDaily, bills: history.ledger };
  renderTableRows("client-daily-table", ledger.daily.map(CLIENT_DAILY.cells));
  renderTableRows("client-ledger-table", ledger.bills.map(CLIENT_LEDGER.cells));
}

function renderTableRows(tableId, rows) {
  document.querySelector(`#${tableId} tbody`).innerHTML = rows.map(tableRowHtml).join("");
}

// ---------- Date range (used by every `dated` summary and client-daily) ----------

function setupDateRange() {
  const today = getTodayIstDateString();
  document.getElementById("start-date").value = today;
  document.getElementById("end-date").value = today;
  updateRangeLabel();

  document.getElementById("date-range-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    updateRangeLabel();
    await loadAnalytics();
  });

  document.getElementById("clear-date-range").addEventListener("click", async () => {
    document.getElementById("start-date").value = "";
    document.getElementById("end-date").value = "";
    updateRangeLabel();
    await loadAnalytics();
  });
}

function buildDateParams() {
  const params = new URLSearchParams();
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  if (start) params.set("startDate", start);
  if (end) params.set("endDate", end);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function updateRangeLabel() {
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  document.getElementById("range-label").textContent =
    !start && !end ? "Showing: all time"
    : start && end && start === end ? `Showing: ${start} only`
    : start && end ? `Showing: ${start} to ${end}`
    : start ? `Showing: from ${start} onward`
    : `Showing: up to ${end}`;
}

// ---------- PDF exports ----------

function pdfSection({ headers, cells }, rows = [], heading) {
  return { heading, headers, rows: rows.map((r) => cells(r).map(cellText)) };
}

function clientDetailSections(dailyHeading, ledgerHeading) {
  return [pdfSection(CLIENT_DAILY, ledger.daily, dailyHeading), pdfSection(CLIENT_LEDGER, ledger.bills, ledgerHeading)];
}

function setupAnalyticsDownloads() {
  const today = () => getTodayIstDateString();
  const rangeSubtitle = () => document.getElementById("range-label").textContent;
  const onClick = (id, handler) => document.getElementById(id).addEventListener("click", handler);

  SUMMARIES.forEach((s) =>
    onClick(`download-${s.path}-pdf`, () =>
      downloadPdfReport({
        title: s.title,
        subtitle: s.dated ? rangeSubtitle() : `As of ${formatDateTime(new Date())}`,
        sections: [pdfSection(s, lastRows[s.path])],
        filename: `${s.file}_${today()}.pdf`,
      })
    )
  );

  onClick("download-client-detail-pdf", () => {
    if (!ledgerClient) {
      alert("Select a client in Per-Client Detail first.");
      return;
    }
    downloadPdfReport({
      title: `Client Detail — ${ledger.name}`,
      subtitle: `Per-day summary: ${rangeSubtitle()} · Bill ledger: full history`,
      sections: clientDetailSections("Per-day summary", "Bill ledger"),
      filename: `client-detail_${ledger.name.replace(/\s+/g, "-").toLowerCase()}_${today()}.pdf`,
    });
  });

  onClick("download-all-pdf", () => {
    const sections = SUMMARIES.map((s) =>
      pdfSection(s, lastRows[s.path], s.dated ? s.title : `${s.title} (current snapshot, not date-filtered)`)
    );
    // Per-Client Detail is only added if a client happens to be selected
    // right now — it's supplementary, not part of the core shop-wide
    // report, so its absence isn't an error.
    if (ledger.name) {
      const prefix = `Per-Client Detail — ${ledger.name}`;
      sections.push(...clientDetailSections(`${prefix} — Per-day summary`, `${prefix} — Bill ledger (full history)`));
    }
    downloadPdfReport({
      title: "Full Analytics Report",
      subtitle: `Date-scoped sections: ${rangeSubtitle()} · Outstanding-balance sections are current snapshots, not date-filtered`,
      sections,
      filename: `full-analytics-report_${today()}.pdf`,
    });
  });
}
