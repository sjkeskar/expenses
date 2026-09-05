let clients = [];
let locations = [];
let categories = [];
let companies = [];
let bills = [];
let clientCombobox = null;
let locationCombobox = null;
let categoryCombobox = null;
let settleCompanyCombobox = null;
let billCombobox = null;
let selectedCategory = null;
let settleBills = [];

async function init() {
  const user = await guardPage("operator");
  if (!user) return;
  document.getElementById("user-name").textContent = `${user.name} (operator)`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();

  setupComboboxes();
  document.getElementById("bill-date").value = getTodayIstDateString();
  await loadClients();
  await loadLocations();
  await loadCategories();
  await loadCompanies();
  await loadBills();
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

async function loadClients() {
  const data = await api("/clients");
  clients = data.clients;
  clientCombobox.updateItems(clients);
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

init();
