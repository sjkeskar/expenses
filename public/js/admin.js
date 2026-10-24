// Admin page: the shared Billing (billing.js) and Analytics (analytics.js)
// tabs, plus the admin-only tabs below.
let reassignBillCombobox = null;
let newCategoryCompanyCombobox = null;
let reassignTargets = [];

async function init() {
  const user = await initRolePage("admin");
  if (!user) return;
  setupTabs();
  // Before initBilling, which loads the lookup lists these register for.
  setupAdminComboboxes();
  initAnalytics();
  await initBilling(user);
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
      document.getElementById("tab-reassign").style.display = "none";
      document.getElementById("tab-locations").style.display = "none";
      document.getElementById("tab-categories").style.display = "none";
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";

      if (btn.dataset.tab === "analytics") await loadAnalytics();
      if (btn.dataset.tab === "promote") await loadOperators();
      if (btn.dataset.tab === "reassign") await loadReassignData();
      if (btn.dataset.tab === "locations") await loadLocationsTable();
      if (btn.dataset.tab === "categories") await loadCategoriesTable();
    });
  });
}

function setupAdminComboboxes() {
  // Any bill is a valid reassignment target — not just pending ones like
  // the Record Payment combobox, since an admin may need to correct
  // attribution on a fully-paid (or even refunded) bill too.
  reassignBillCombobox = comboboxById("reassign-bill", {
    renderLabel: (b) => `${b.billNumber} — ${b.client.name}`,
    renderSub: (b) => `Current operator: ${b.createdBy ? b.createdBy.name : "Unattributed (legacy bill)"}`,
    onSelect: (bill) => loadReassignHistory(bill.id),
  });
  document.getElementById("reassign-bill-input").addEventListener("input", () => {
    if (!document.getElementById("reassign-bill-id").value) renderReassignHistory(null);
  });

  // Company field on the "Add Category" form — find-or-create, same
  // pattern as the Client field on the bill form. Only relevant when
  // "credit" is chosen as the category's behavior.
  newCategoryCompanyCombobox = comboboxById("new-category-company", { lookup: "companies", renderLabel: (c) => c.name });
  document.getElementById("new-category-type").addEventListener("change", (e) => {
    const isCredit = e.target.value === "credit";
    document.getElementById("new-category-company-field").style.display = isCredit ? "block" : "none";
    if (!isCredit) newCategoryCompanyCombobox.clear();
  });
}

// ---------- Promote ----------

async function loadOperators() {
  const { operators } = await api("/users/operators");
  const select = document.getElementById("promote-user");
  select.innerHTML = operators
    .map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`)
    .join("");
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

// ---------- Reassign Operator ----------

async function loadReassignData() {
  // All bills, not just the admin's own — any bill can be reassigned.
  const data = await api("/bills");
  reassignBillCombobox.updateItems(data.bills);

  const { targets } = await api("/users/reassign-targets");
  reassignTargets = targets;
  const select = document.getElementById("reassign-target");
  select.innerHTML = targets
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${escapeHtml(t.role)})</option>`)
    .join("");

  renderReassignHistory(null);
}

// Re-fetches the single bill (GET /bills/:id) because the bulk list from
// GET /bills does not include its reassignment history — only the
// single-bill endpoint does (see bills.js).
async function loadReassignHistory(billId) {
  try {
    const { bill } = await api(`/bills/${billId}`);
    renderReassignHistory(bill);
  } catch (err) {
    renderReassignHistory(null);
  }
}

function renderReassignHistory(bill) {
  const empty = document.getElementById("reassign-history-empty");
  const table = document.getElementById("reassign-history-table");
  const tbody = table.querySelector("tbody");

  const history = bill && bill.reassignments ? bill.reassignments : [];
  if (!history.length) {
    tbody.innerHTML = "";
    table.style.display = "none";
    empty.style.display = "block";
    empty.textContent = bill
      ? "This bill has never been reassigned."
      : "Select a bill above to see its full reassignment history.";
    return;
  }

  empty.style.display = "none";
  table.style.display = "table";
  tbody.innerHTML = history
    .map(
      (r) => `
      <tr>
        <td>${formatDateTime(r.reassignedAt)}</td>
        <td>${r.fromOperator ? escapeHtml(r.fromOperator.name) : "Unattributed (legacy bill)"}</td>
        <td>${escapeHtml(r.toOperator.name)}</td>
        <td>${escapeHtml(r.reassignedBy.name)}</td>
      </tr>`
    )
    .join("");
}

document.getElementById("reassign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("reassign-msg");
  const billId = document.getElementById("reassign-bill-id").value;
  const operatorId = document.getElementById("reassign-target").value;

  if (!billId) {
    showMessage(msg, "Pick a bill from the dropdown first.", true);
    return;
  }

  const target = reassignTargets.find((t) => t.id === operatorId);
  if (!confirm(`Reassign this bill to ${target ? target.name : "the selected user"}? This will be recorded permanently in the audit trail.`)) {
    return;
  }

  try {
    const { bill } = await api(`/bills/${billId}/reassign-operator`, {
      method: "PATCH",
      body: { operatorId },
    });
    showMessage(msg, `Bill ${bill.billNumber} reassigned to ${bill.createdBy.name}.`, false);
    await loadReassignData();
    renderReassignHistory(bill);
    await loadBills();
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
        <td>${escapeHtml(l.name)}</td>
        <td>${escapeHtml(l.locationCode)}</td>
        <td>${formatDateTime(l.createdAt)}</td>
        <td><button class="danger" data-id="${escapeHtml(l.id)}">Delete</button></td>
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
    await loadLookup("locations");
  } catch (err) {
    showMessage(msg, err.message, true);
  }
}

document.getElementById("add-location-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-location-name");
  const codeInput = document.getElementById("new-location-code");
  const msg = document.getElementById("add-location-msg");
  try {
    const { location } = await api("/locations", {
      method: "POST",
      body: { name: nameInput.value, locationCode: codeInput.value },
    });
    showMessage(msg, `Location "${location.name}" (code ${location.locationCode}) added.`, false);
    nameInput.value = "";
    codeInput.value = "";
    await loadLocationsTable();
    await loadLookup("locations");
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
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.type)}</td>
        <td>${c.company ? escapeHtml(c.company.name) : "—"}</td>
        <td>${formatDateTime(c.createdAt)}</td>
        <td><button class="danger" data-id="${escapeHtml(c.id)}">Delete</button></td>
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
    await loadLookup("categories");
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
    await loadLookup("categories");
    await loadLookup("companies");
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

init();
