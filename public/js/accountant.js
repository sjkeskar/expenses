let clients = [];
let ledgerClientCombobox = null;
let currentLedgerClientId = null;

// Cached from the last successful loadAnalytics()/loadClientDetail() calls,
// so the Download PDF buttons export exactly what's currently on screen
// (respecting the active date range) without needing a fresh API call.
let lastDayWise = [];
let lastOperatorWise = [];
let lastLocationWise = [];
let lastCategoryWise = [];
let lastCompanyOutstanding = [];
let lastClientOutstanding = [];
let lastClientDaily = [];
let lastClientLedger = [];
let lastLedgerClientName = "";

async function init() {
  const user = await guardPage("accountant");
  if (!user) return;
  document.getElementById("user-name").textContent = `${user.name} (accountant)`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();
  setupComboboxes();
  setupDateRange();
  setupAnalyticsDownloads();

  await loadClients();
  await loadAnalytics();
}

function setupComboboxes() {
  ledgerClientCombobox = attachCombobox({
    input: document.getElementById("ledger-client-input"),
    dropdown: document.getElementById("ledger-client-dropdown"),
    hiddenInput: document.getElementById("ledger-client-id"),
    items: [],
    renderLabel: (c) => c.name,
    onSelect: (client) => {
      currentLedgerClientId = client.id;
      loadClientDetail();
    },
  });
}

async function loadClients() {
  const data = await api("/clients");
  clients = data.clients;
  ledgerClientCombobox.updateItems(clients);
}

// ---------- Date range (used by day-wise, operator-wise, location-wise, category-wise, client-daily) ----------

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
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  const params = new URLSearchParams();
  if (start) params.set("startDate", start);
  if (end) params.set("endDate", end);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function updateRangeLabel() {
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  const label = document.getElementById("range-label");
  if (!start && !end) {
    label.textContent = "Showing: all time";
  } else if (start && end && start === end) {
    label.textContent = `Showing: ${start} only`;
  } else if (start && end) {
    label.textContent = `Showing: ${start} to ${end}`;
  } else if (start) {
    label.textContent = `Showing: from ${start} onward`;
  } else {
    label.textContent = `Showing: up to ${end}`;
  }
}

// ---------- Analytics ----------

async function loadAnalytics() {
  const qs = buildDateParams();

  const [dayWise, operatorWise, locationWise, categoryWise, companyOutstanding, clientOutstanding] = await Promise.all([
    api(`/analytics/day-wise${qs}`),
    api(`/analytics/operator-wise${qs}`),
    api(`/analytics/location-wise${qs}`),
    api(`/analytics/category-wise${qs}`),
    api("/analytics/company-outstanding"),
    api("/analytics/client-outstanding"),
  ]);

  lastDayWise = dayWise.dayWise;
  lastOperatorWise = operatorWise.operatorWise;
  lastLocationWise = locationWise.locationWise;
  lastCategoryWise = categoryWise.categoryWise;
  lastCompanyOutstanding = companyOutstanding.companyOutstanding;
  lastClientOutstanding = clientOutstanding.clientOutstanding;

  document.querySelector("#day-wise-table tbody").innerHTML = dayWise.dayWise
    .map(
      (r) => `
      <tr>
        <td>${formatDate(r.day)}</td>
        <td>${formatCurrency(r.total_collected)}</td>
        <td>${r.transaction_count}</td>
        <td>${r.cash_count} (${formatCurrency(r.cash_total)})</td>
        <td>${r.credit_card_count} (${formatCurrency(r.credit_card_total)})</td>
        <td>${r.upi_count} (${formatCurrency(r.upi_total)})</td>
      </tr>`
    )
    .join("");

  document.querySelector("#operator-wise-table tbody").innerHTML = operatorWise.operatorWise
    .map(
      (r) => `
      <tr>
        <td>${r.operatorName}</td>
        <td>${formatCurrency(r.totalBilled || 0)}</td>
        <td>${formatCurrency(r.totalDiscount || 0)}</td>
        <td>${formatCurrency(r.totalCollected || 0)}</td>
        <td>${r.billsCreated || 0}</td>
        <td>${r.transactionCount || 0}</td>
      </tr>`
    )
    .join("");

  document.querySelector("#location-wise-table tbody").innerHTML = locationWise.locationWise
    .map(
      (r) => `
      <tr>
        <td>${r.location_name}</td>
        <td>${formatCurrency(r.total_billed || 0)}</td>
        <td>${formatCurrency(r.total_discount || 0)}</td>
        <td>${formatCurrency(r.total_pending || 0)}</td>
        <td>${r.bills_created || 0}</td>
      </tr>`
    )
    .join("");

  document.querySelector("#category-wise-table tbody").innerHTML = categoryWise.categoryWise
    .map(
      (r) => `
      <tr>
        <td>${r.category_name}</td>
        <td>${r.category_type || "—"}</td>
        <td>${r.bill_count || 0}</td>
        <td>${formatCurrency(r.total_billed || 0)}</td>
      </tr>`
    )
    .join("");

  document.querySelector("#company-outstanding-table tbody").innerHTML = companyOutstanding.companyOutstanding
    .map(
      (r) =>
        `<tr><td>${r.company_name}</td><td>${formatCurrency(r.outstanding_balance)}</td><td>${r.pending_bill_count}</td></tr>`
    )
    .join("");

  document.querySelector("#client-outstanding-table tbody").innerHTML = clientOutstanding.clientOutstanding
    .map(
      (r) =>
        `<tr><td>${r.client_name}</td><td>${formatCurrency(r.outstanding_balance)}</td><td>${r.pending_bill_count}</td></tr>`
    )
    .join("");

  if (currentLedgerClientId) {
    await loadClientDetail();
  }
}

async function loadClientDetail() {
  if (!currentLedgerClientId) return;
  const qs = buildDateParams();

  const [daily, ledger] = await Promise.all([
    api(`/analytics/client-daily/${currentLedgerClientId}${qs}`),
    api(`/analytics/client-ledger/${currentLedgerClientId}`),
  ]);

  lastClientDaily = daily.clientDaily;
  lastClientLedger = ledger.ledger;
  const selectedClient = clients.find((c) => c.id === currentLedgerClientId);
  lastLedgerClientName = selectedClient ? selectedClient.name : "";

  document.querySelector("#client-daily-table tbody").innerHTML = daily.clientDaily
    .map(
      (r) =>
        `<tr><td>${formatDate(r.day)}</td><td>${formatCurrency(r.total_collected)}</td><td>${r.transaction_count}</td></tr>`
    )
    .join("");

  document.querySelector("#client-ledger-table tbody").innerHTML = ledger.ledger
    .map((b) => {
      const payments = b.transactions
        .map((t) => `${formatCurrency(t.amountCollected)} (${t.mode}, ${t.operator.name})`)
        .join("; ") || "—";
      return `<tr>
        <td>${b.billNumber}</td>
        <td>${formatCurrency(b.netAmount)}</td>
        <td>${formatCurrency(b.balance)}</td>
        <td><span class="badge ${b.status}">${b.status === "fully_paid" ? "Fully Paid" : "Pending"}</span></td>
        <td>${payments}</td>
      </tr>`;
    })
    .join("");
}

// ---------- PDF exports ----------

function setupAnalyticsDownloads() {
  const todayStr = () => getTodayIstDateString();
  const rangeSubtitle = () => document.getElementById("range-label").textContent;
  const snapshotSubtitle = () => `As of ${formatDateTime(new Date())}`;

  document.getElementById("download-day-wise-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Day-wise Summary",
      subtitle: rangeSubtitle(),
      sections: [
        {
          headers: ["Day", "Total Collected", "Transactions", "Cash", "Credit Card", "UPI"],
          rows: lastDayWise.map((r) => [
            formatDate(r.day),
            formatCurrency(r.total_collected),
            r.transaction_count,
            `${r.cash_count} (${formatCurrency(r.cash_total)})`,
            `${r.credit_card_count} (${formatCurrency(r.credit_card_total)})`,
            `${r.upi_count} (${formatCurrency(r.upi_total)})`,
          ]),
        },
      ],
      filename: `day-wise-summary_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-operator-wise-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Operator-wise Summary",
      subtitle: rangeSubtitle(),
      sections: [
        {
          headers: ["Operator", "Total Billed", "Discount Given", "Amount Collected", "Bills Created", "Payments Taken"],
          rows: lastOperatorWise.map((r) => [
            r.operatorName,
            formatCurrency(r.totalBilled || 0),
            formatCurrency(r.totalDiscount || 0),
            formatCurrency(r.totalCollected || 0),
            r.billsCreated || 0,
            r.transactionCount || 0,
          ]),
        },
      ],
      filename: `operator-wise-summary_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-location-wise-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Location-wise Summary",
      subtitle: rangeSubtitle(),
      sections: [
        {
          headers: ["Location", "Total Billed", "Discount Given", "Pending Amount", "Bills Created"],
          rows: lastLocationWise.map((r) => [
            r.location_name,
            formatCurrency(r.total_billed || 0),
            formatCurrency(r.total_discount || 0),
            formatCurrency(r.total_pending || 0),
            r.bills_created || 0,
          ]),
        },
      ],
      filename: `location-wise-summary_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-category-wise-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Category-wise Summary",
      subtitle: rangeSubtitle(),
      sections: [
        {
          headers: ["Category", "Behavior", "Bills", "Total Billed"],
          rows: lastCategoryWise.map((r) => [
            r.category_name,
            r.category_type || "—",
            r.bill_count || 0,
            formatCurrency(r.total_billed || 0),
          ]),
        },
      ],
      filename: `category-wise-summary_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-company-outstanding-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Company Outstanding Balances",
      subtitle: snapshotSubtitle(),
      sections: [
        {
          headers: ["Company", "Outstanding Balance", "Pending Bills"],
          rows: lastCompanyOutstanding.map((r) => [
            r.company_name,
            formatCurrency(r.outstanding_balance),
            r.pending_bill_count,
          ]),
        },
      ],
      filename: `company-outstanding_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-client-outstanding-pdf").addEventListener("click", () => {
    downloadPdfReport({
      title: "Client Outstanding Balances",
      subtitle: snapshotSubtitle(),
      sections: [
        {
          headers: ["Client", "Outstanding Balance", "Pending Bills"],
          rows: lastClientOutstanding.map((r) => [
            r.client_name,
            formatCurrency(r.outstanding_balance),
            r.pending_bill_count,
          ]),
        },
      ],
      filename: `client-outstanding_${todayStr()}.pdf`,
    });
  });

  document.getElementById("download-client-detail-pdf").addEventListener("click", () => {
    if (!currentLedgerClientId) {
      alert("Select a client in Per-Client Detail first.");
      return;
    }
    downloadPdfReport({
      title: `Client Detail — ${lastLedgerClientName}`,
      subtitle: `Per-day summary: ${rangeSubtitle()} · Bill ledger: full history`,
      sections: [
        {
          heading: "Per-day summary",
          headers: ["Day", "Total Collected", "Transactions"],
          rows: lastClientDaily.map((r) => [formatDate(r.day), formatCurrency(r.total_collected), r.transaction_count]),
        },
        {
          heading: "Bill ledger",
          headers: ["Bill #", "Net Amount", "Balance", "Status", "Payments"],
          rows: lastClientLedger.map((b) => [
            b.billNumber,
            formatCurrency(b.netAmount),
            formatCurrency(b.balance),
            b.status === "fully_paid" ? "Fully Paid" : "Pending",
            b.transactions.map((t) => `${formatCurrency(t.amountCollected)} (${t.mode}, ${t.operator.name})`).join("; ") || "—",
          ]),
        },
      ],
      filename: `client-detail_${lastLedgerClientName.replace(/\s+/g, "-").toLowerCase()}_${todayStr()}.pdf`,
    });
  });
}

init();
