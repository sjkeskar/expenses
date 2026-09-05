let clients = [];
let locations = [];
let categories = [];
let companies = [];
let bills = [];
let clientCombobox = null;
let locationCombobox = null;
let categoryCombobox = null;
let newCategoryCompanyCombobox = null;
let settleCompanyCombobox = null;
let billCombobox = null;
let ledgerClientCombobox = null;
let currentLedgerClientId = null;
let selectedCategory = null;
let settleBills = [];

async function init() {
  const user = await guardPage("admin");
  if (!user) return;
  document.getElementById("user-name").textContent = `${user.name} (admin)`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();
  setupTabs();
  setupComboboxes();
  setupDateRange();
  document.getElementById("bill-date").value = getTodayIstDateString();

  await loadClients();
  await loadLocations();
  await loadCategories();
  await loadCompanies();
  await loadBills();
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tabs button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-billing").style.display = "none";
      document.getElementById("tab-analytics").style.display = "none";
      document.getElementById("tab-promote").style.display = "none";
      document.getElementById("tab-locations").style.display = "none";
      document.getElementById("tab-categories").style.display = "none";
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";

      if (btn.dataset.tab === "analytics") await loadAnalytics();
      if (btn.dataset.tab === "promote") await loadOperators();
      if (btn.dataset.tab === "locations") await loadLocationsTable();
      if (btn.dataset.tab === "categories") await loadCategoriesTable();
    });
  });
}

function setupComboboxes() {
  clientCombobox = attachCombobox({
    input: document.getElementById("bill-client-input"),
    dropdown: document.getElementById("bill-client-dropdown"),
    hiddenInput: document.getElementById("bill-client-id"),
    items: [],
    renderLabel: (c) => c.name,
  });

  locationCombobox = attachCombobox({
    input: document.getElementById("bill-location-input"),
    dropdown: document.getElementById("bill-location-dropdown"),
    hiddenInput: document.getElementById("bill-location-id"),
    items: [],
    renderLabel: (l) => l.name,
  });

  categoryCombobox = attachCombobox({
    input: document.getElementById("bill-category-input"),
    dropdown: document.getElementById("bill-category-dropdown"),
    hiddenInput: document.getElementById("bill-category-id"),
    items: [],
    renderLabel: (c) => c.name,
    renderSub: (c) => (c.type === "credit" && c.company ? `Credit — ${c.company.name}` : "Standard"),
    onSelect: (category) => applyCategorySelection(category),
  });

  document.getElementById("bill-category-input").addEventListener("input", () => {
    if (!document.getElementById("bill-category-id").value) {
      applyCategorySelection(null);
    }
  });

  billCombobox = attachCombobox({
    input: document.getElementById("tx-bill-input"),
    dropdown: document.getElementById("tx-bill-dropdown"),
    hiddenInput: document.getElementById("tx-bill-id"),
    items: [],
    renderLabel: (b) => `${b.billNumber} — ${b.client.name}`,
    renderSub: (b) => `Balance: ${formatCurrency(b.balance)}`,
  });

  settleCompanyCombobox = attachCombobox({
    input: document.getElementById("settle-company-input"),
    dropdown: document.getElementById("settle-company-dropdown"),
    hiddenInput: document.getElementById("settle-company-id"),
    items: [],
    renderLabel: (c) => c.name,
    onSelect: (company) => loadSettleBillsList(company.id),
  });

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

  // Company field on the "Add Category" form — find-or-create, same
  // pattern as the Client field on the bill form. Only relevant when
  // "credit" is chosen as the category's behavior.
  newCategoryCompanyCombobox = attachCombobox({
    input: document.getElementById("new-category-company-input"),
    dropdown: document.getElementById("new-category-company-dropdown"),
    hiddenInput: document.getElementById("new-category-company-id"),
    items: [],
    renderLabel: (c) => c.name,
  });

  document.getElementById("new-category-type").addEventListener("change", (e) => {
    const field = document.getElementById("new-category-company-field");
    if (e.target.value === "credit") {
      field.style.display = "block";
    } else {
      field.style.display = "none";
      newCategoryCompanyCombobox.clear();
    }
  });
}

function applyCategorySelection(category) {
  selectedCategory = category;
  const info = document.getElementById("bill-category-info");
  if (category && category.type === "credit" && category.company) {
    info.textContent = `Credit bill — will be billed to ${category.company.name}.`;
  } else {
    info.textContent = "";
  }
}

async function loadSettleBillsList(companyId) {
  const container = document.getElementById("settle-bills-container");
  const tbody = document.querySelector("#settle-bills-table tbody");
  const totalInfo = document.getElementById("settle-total-info");

  try {
    const data = await api(`/companies/${companyId}/outstanding`);
    settleBills = data.pendingBills;

    if (settleBills.length === 0) {
      tbody.innerHTML = "";
      container.style.display = "block";
      totalInfo.textContent = "This company has no outstanding bills.";
      return;
    }

    tbody.innerHTML = settleBills
      .map(
        (b) => `
        <tr>
          <td><input type="checkbox" class="settle-bill-checkbox" data-id="${b.id}" data-balance="${b.balance}" /></td>
          <td>${b.billNumber}</td>
          <td>${b.client.name}</td>
          <td>${formatCurrency(b.balance)}</td>
          <td>${formatDateTime(b.createdAt)}</td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll(".settle-bill-checkbox").forEach((cb) => {
      cb.addEventListener("change", updateSettleTotal);
    });

    container.style.display = "block";
    updateSettleTotal();
  } catch (err) {
    settleBills = [];
    tbody.innerHTML = "";
    container.style.display = "none";
  }
}

function updateSettleTotal() {
  const checked = document.querySelectorAll(".settle-bill-checkbox:checked");
  let total = 0;
  checked.forEach((cb) => (total += Number(cb.dataset.balance)));
  document.getElementById("settle-total-info").textContent = `Total selected: ${formatCurrency(total)} (${checked.length} bill${checked.length === 1 ? "" : "s"})`;
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

// ---------- Billing ----------

async function loadClients() {
  const data = await api("/clients");
  clients = data.clients;
  clientCombobox.updateItems(clients);
  ledgerClientCombobox.updateItems(clients);
}

async function loadLocations() {
  const data = await api("/locations");
  locations = data.locations;
  locationCombobox.updateItems(locations);
}

async function loadCategories() {
  const data = await api("/categories");
  categories = data.categories;
  categoryCombobox.updateItems(categories);
}

async function loadCompanies() {
  const data = await api("/companies");
  companies = data.companies;
  settleCompanyCombobox.updateItems(companies);
  newCategoryCompanyCombobox.updateItems(companies);
}

async function loadBills() {
  const data = await api("/bills");
  bills = data.bills;

  const tbody = document.querySelector("#bills-table tbody");
  tbody.innerHTML = bills
    .map(
      (b) => `
      <tr>
        <td>${b.billNumber}</td>
        <td>${b.client.name}</td>
        <td>${b.category ? b.category.name : "—"}</td>
        <td>${b.company ? b.company.name : "—"}</td>
        <td>${b.location ? b.location.name : "—"}</td>
        <td>${formatCurrency(b.netAmount)}</td>
        <td>${formatCurrency(b.balance)}</td>
        <td><span class="badge ${b.status}">${b.status === "fully_paid" ? "Fully Paid" : "Pending"}</span></td>
        <td>${formatDateTime(b.createdAt)}</td>
      </tr>`
    )
    .join("");

  const pendingBills = bills.filter((b) => b.status === "pending");
  billCombobox.updateItems(pendingBills);
}

document.getElementById("bill-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("bill-msg");

  const clientInput = document.getElementById("bill-client-input");
  const clientId = document.getElementById("bill-client-id").value;
  const locationId = document.getElementById("bill-location-id").value;
  const categoryId = document.getElementById("bill-category-id").value;
  const billDate = document.getElementById("bill-date").value;
  const originalAmount = document.getElementById("original-amount").value;
  const discountAmount = document.getElementById("discount-amount").value;
  const initialAmount = document.getElementById("initial-amount").value;
  const initialMode = document.getElementById("initial-mode").value;

  if (!clientInput.value.trim()) {
    showMessage(msg, "Enter a client name.", true);
    return;
  }
  if (!billDate) {
    showMessage(msg, "Select a bill date.", true);
    return;
  }
  if (!locationId) {
    showMessage(msg, "Select a valid location from the suggestions list.", true);
    return;
  }
  if (!categoryId) {
    showMessage(msg, "Select a valid category from the suggestions list.", true);
    return;
  }

  const body = { originalAmount, discountAmount, billDate, locationId, categoryId };
  if (clientId) {
    body.clientId = clientId;
  } else {
    body.clientName = clientInput.value.trim();
  }
  if (Number(initialAmount) > 0) {
    body.initialAmountCollected = initialAmount;
    body.initialMode = initialMode;
  }

  try {
    const { bill } = await api("/bills", { method: "POST", body });
    const companyNote = bill.company ? ` (billed to ${bill.company.name})` : "";
    showMessage(
      msg,
      `Bill ${bill.billNumber} created for ${bill.client.name} — ${bill.category.name}${companyNote} — balance ${formatCurrency(bill.balance)}.`,
      false
    );
    clientCombobox.clear();
    locationCombobox.clear();
    categoryCombobox.clear();
    applyCategorySelection(null);
    document.getElementById("bill-date").value = getTodayIstDateString();
    document.getElementById("original-amount").value = "";
    document.getElementById("discount-amount").value = "0";
    document.getElementById("initial-amount").value = "0";
    await loadClients();
    await loadBills();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

document.getElementById("transaction-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("tx-msg");
  const billId = document.getElementById("tx-bill-id").value;
  const amountCollected = document.getElementById("tx-amount").value;
  const mode = document.getElementById("tx-mode").value;

  if (!billId) {
    showMessage(msg, "Select a valid pending bill from the suggestions list.", true);
    return;
  }

  try {
    await api("/transactions", { method: "POST", body: { billId, amountCollected, mode } });
    showMessage(msg, "Payment recorded.", false);
    billCombobox.clear();
    document.getElementById("tx-amount").value = "";
    await loadBills();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

document.getElementById("settle-submit-btn").addEventListener("click", async () => {
  const msg = document.getElementById("settle-msg");
  const companyId = document.getElementById("settle-company-id").value;
  const mode = document.getElementById("settle-mode").value;
  const checked = Array.from(document.querySelectorAll(".settle-bill-checkbox:checked"));

  if (!companyId) {
    showMessage(msg, "Select a valid company from the suggestions list.", true);
    return;
  }
  if (checked.length === 0) {
    showMessage(msg, "Check at least one bill to settle.", true);
    return;
  }

  const billIds = checked.map((cb) => cb.dataset.id);

  try {
    const result = await api(`/companies/${companyId}/settle`, { method: "POST", body: { billIds, mode } });
    const breakdown = result.breakdown.map((b) => `${b.billNumber}: ${formatCurrency(b.amountApplied)}`).join("; ");
    showMessage(msg, `Settled ${formatCurrency(result.totalSettled)} for ${result.company.name}. ${breakdown}`, false);
    settleCompanyCombobox.clear();
    document.getElementById("settle-bills-container").style.display = "none";
    settleBills = [];
    await loadBills();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

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

// ---------- Promote ----------

async function loadOperators() {
  const { operators } = await api("/users/operators");
  const select = document.getElementById("promote-user");
  select.innerHTML = operators.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
}

document.getElementById("promote-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("promote-user").value;
  const msg = document.getElementById("promote-msg");
  try {
    const { user } = await api(`/users/${id}/promote`, { method: "PATCH" });
    showMessage(msg, `${user.name} promoted to admin.`, false);
    await loadOperators();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

// ---------- Locations ----------

async function loadLocationsTable() {
  const { locations: allLocations } = await api("/locations");
  const tbody = document.querySelector("#locations-table tbody");
  tbody.innerHTML = allLocations
    .map(
      (l) => `
      <tr>
        <td>${l.name}</td>
        <td>${formatDateTime(l.createdAt)}</td>
        <td><button class="danger" data-id="${l.id}">Delete</button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLocation(btn.dataset.id));
  });
}

async function deleteLocation(id) {
  const msg = document.getElementById("location-action-msg");
  if (!confirm("Delete this location? It will no longer be selectable for new bills, but existing bills will keep showing it.")) {
    return;
  }
  try {
    await api(`/locations/${id}`, { method: "DELETE" });
    showMessage(msg, "Location deleted.", false);
    await loadLocationsTable();
    await loadLocations();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
}

document.getElementById("add-location-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-location-name");
  const msg = document.getElementById("add-location-msg");
  try {
    const { location } = await api("/locations", { method: "POST", body: { name: nameInput.value } });
    showMessage(msg, `Location "${location.name}" added.`, false);
    nameInput.value = "";
    await loadLocationsTable();
    await loadLocations();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

// ---------- Categories (companies are created inline here, not via a separate screen) ----------

async function loadCategoriesTable() {
  const { categories: allCategories } = await api("/categories");
  const tbody = document.querySelector("#categories-table tbody");
  tbody.innerHTML = allCategories
    .map(
      (c) => `
      <tr>
        <td>${c.name}</td>
        <td>${c.type}</td>
        <td>${c.company ? c.company.name : "—"}</td>
        <td>${formatDateTime(c.createdAt)}</td>
        <td><button class="danger" data-id="${c.id}">Delete</button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deleteCategory(btn.dataset.id));
  });
}

async function deleteCategory(id) {
  const msg = document.getElementById("category-action-msg");
  if (!confirm("Delete this category? It will no longer be selectable for new bills, but existing bills will keep showing it. Its linked company (if any) is unaffected — it can still be settled.")) {
    return;
  }
  try {
    await api(`/categories/${id}`, { method: "DELETE" });
    showMessage(msg, "Category deleted.", false);
    await loadCategoriesTable();
    await loadCategories();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
}

document.getElementById("add-category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-category-name");
  const typeSelect = document.getElementById("new-category-type");
  const companyInput = document.getElementById("new-category-company-input");
  const companyId = document.getElementById("new-category-company-id").value;
  const msg = document.getElementById("add-category-msg");

  const body = { name: nameInput.value, type: typeSelect.value };
  if (typeSelect.value === "credit") {
    if (!companyInput.value.trim()) {
      showMessage(msg, "Enter a company name for this credit category.", true);
      return;
    }
    if (companyId) {
      body.companyId = companyId;
    } else {
      body.companyName = companyInput.value.trim();
    }
  }

  try {
    const { category } = await api("/categories", { method: "POST", body });
    const companyNote = category.company ? ` (${category.company.name})` : "";
    showMessage(msg, `Category "${category.name}" (${category.type})${companyNote} added.`, false);
    nameInput.value = "";
    typeSelect.value = "standard";
    newCategoryCompanyCombobox.clear();
    document.getElementById("new-category-company-field").style.display = "none";
    await loadCategoriesTable();
    await loadCategories();
    await loadCompanies();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

init();
