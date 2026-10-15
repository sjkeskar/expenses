let clients = [];
let locations = [];
let categories = [];
let companies = [];
let bills = [];
let currentUserId = null;
let myBillsCache = [];
let myBillsTotals = { billed: 0, net: 0, collected: 0, discount: 0, outstanding: 0 };
let clientCombobox = null;
let locationCombobox = null;
let categoryCombobox = null;
let settleCompanyCombobox = null;
let billCombobox = null;
let selectedCategory = null;
let settleBills = [];
let pendingRefundBillId = null;
let refundDialog = null; // { open, close } from setupModal — see common.js

// Once a bill is refunded, balance is force-zeroed by the refund itself
// (not reached through normal payment), so "netAmount - balance" stops
// being a valid way to read off "amount collected" — refundedAmount is
// the snapshot taken at refund time for exactly this reason.
function getCollectedAmount(bill) {
  return bill.status === "refunded" ? Number(bill.refundedAmount) : Number(bill.netAmount) - Number(bill.balance);
}

function statusLabel(status) {
  if (status === "fully_paid") return "Fully Paid";
  if (status === "refunded") return "Refunded";
  return "Pending";
}

async function init() {
  const user = await guardPage("operator");
  if (!user) return;
  currentUserId = user.id;
  document.getElementById("user-name").textContent = `${user.name} (operator)`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();
  setupRefundModal();

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
    renderSub: (l) => `Code: ${l.locationCode}`,
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
          <td><input type="checkbox" class="settle-bill-checkbox" data-id="${escapeHtml(b.id)}" data-balance="${escapeHtml(b.balance)}" aria-label="Settle bill ${escapeHtml(b.billNumber)} — ${escapeHtml(b.client.name)}" /></td>
          <td>${escapeHtml(b.billNumber)}</td>
          <td>${escapeHtml(b.client.name)}</td>
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

function openRefundModal(bill, opener) {
  pendingRefundBillId = bill.id;
  const collected = getCollectedAmount(bill);
  document.getElementById("refund-modal-details").textContent =
    `Bill ${bill.billNumber} — ${bill.client.name}. Amount paid so far: ${formatCurrency(collected)}. Confirm this amount has been refunded to the client?`;
  const msg = document.getElementById("refund-modal-msg");
  msg.textContent = "";
  msg.className = "msg";
  refundDialog.open(opener);
}

function closeRefundModal() {
  // setupModal's onClose clears pendingRefundBillId and restores focus.
  refundDialog.close();
}

function setupRefundModal() {
  const modal = document.getElementById("refund-modal");
  refundDialog = setupModal(modal, {
    onClose: () => {
      pendingRefundBillId = null;
    },
  });

  document.getElementById("refund-modal-cancel").addEventListener("click", closeRefundModal);
  modal.addEventListener("click", (e) => {
    if (e.target.id === "refund-modal") closeRefundModal();
  });
  document.getElementById("refund-modal-confirm").addEventListener("click", async () => {
    if (!pendingRefundBillId) return;
    const msg = document.getElementById("refund-modal-msg");
    try {
      await api(`/bills/${pendingRefundBillId}/refund`, { method: "PATCH" });
      closeRefundModal();
      await loadBills();
    } catch (err) {
      showMessage(msg, err.message, true);
    }
  });
}

async function loadBills() {
  const data = await api("/bills");
  bills = data.bills; // full list — needed so Record Payment can top up ANY pending bill, not just your own

  // The visible table only shows bills YOU created — see the note in the
  // card for why: it's your personal work log, not the shop-wide total
  // (that's what Analytics is for, on the admin/accountant side).
  myBillsCache = bills.filter((b) => b.createdBy && b.createdBy.id === currentUserId);

  // Refunded bills stay VISIBLE as individual rows (for your own record),
  // but are excluded from the Total row — matching how they're excluded
  // from every Analytics aggregate too.
  const activeBills = myBillsCache.filter((b) => b.status !== "refunded");
  const refundedCount = myBillsCache.length - activeBills.length;

  myBillsTotals = activeBills.reduce(
    (acc, b) => {
      acc.billed += Number(b.originalAmount);
      acc.net += Number(b.netAmount);
      acc.collected += getCollectedAmount(b);
      acc.discount += Number(b.discountAmount);
      acc.outstanding += Number(b.balance);
      return acc;
    },
    { billed: 0, net: 0, collected: 0, discount: 0, outstanding: 0 }
  );

  const tbody = document.querySelector("#bills-table tbody");
  const rowsHtml = myBillsCache
    .map((b) => {
      const collected = getCollectedAmount(b);
      const canRefund = b.status !== "refunded" && collected > 0;
      const actionsCell = canRefund
        ? `<button class="danger refund-btn" data-id="${escapeHtml(b.id)}">Refund</button>`
        : "—";
      return `
      <tr>
        <td>${escapeHtml(b.billNumber)}</td>
        <td>${escapeHtml(b.client.name)}</td>
        <td>${b.category ? escapeHtml(b.category.name) : "—"}</td>
        <td>${b.company ? escapeHtml(b.company.name) : "—"}</td>
        <td>${b.location ? escapeHtml(b.location.name) : "—"}</td>
        <td>${formatCurrency(b.netAmount)}</td>
        <td>${formatCurrency(collected)}</td>
        <td>${formatCurrency(b.discountAmount)}</td>
        <td>${formatCurrency(b.balance)}</td>
        <td><span class="badge ${escapeHtml(b.status)}">${statusLabel(b.status)}</span></td>
        <td>${formatDateTime(b.createdAt)}</td>
        <td>${actionsCell}</td>
      </tr>`;
    })
    .join("");

  const totalRowHtml = activeBills.length
    ? `
      <tr class="total-row">
        <td colspan="5">Total (${activeBills.length} bill${activeBills.length === 1 ? "" : "s"}${refundedCount ? `, ${refundedCount} refunded excluded` : ""})</td>
        <td>${formatCurrency(myBillsTotals.net)}</td>
        <td>${formatCurrency(myBillsTotals.collected)}</td>
        <td>${formatCurrency(myBillsTotals.discount)}</td>
        <td>${formatCurrency(myBillsTotals.outstanding)}</td>
        <td colspan="3"></td>
      </tr>`
    : "";

  tbody.innerHTML = rowsHtml + totalRowHtml;

  tbody.querySelectorAll(".refund-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bill = myBillsCache.find((b) => b.id === btn.dataset.id);
      if (bill) openRefundModal(bill, btn);
    });
  });

  document.getElementById("my-bills-summary").textContent =
    `Total bills: ${myBillsCache.length}${refundedCount ? ` (${refundedCount} refunded)` : ""} — Billed: ${formatCurrency(myBillsTotals.billed)}, ` +
    `Collected: ${formatCurrency(myBillsTotals.collected)}, Discount: ${formatCurrency(myBillsTotals.discount)}, ` +
    `Outstanding: ${formatCurrency(myBillsTotals.outstanding)}`;

  const pendingBills = bills.filter((b) => b.status === "pending");
  billCombobox.updateItems(pendingBills);
}

document.getElementById("bill-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitOnce(submitButtonFor(e), async () => {
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
});

document.getElementById("transaction-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitOnce(submitButtonFor(e), async () => {
    const msg = document.getElementById("tx-msg");
    const billId = document.getElementById("tx-bill-id").value;
    const amountCollected = document.getElementById("tx-amount").value;
    const discountAmount = document.getElementById("tx-discount").value;
    const mode = document.getElementById("tx-mode").value;

    if (!billId) {
      showMessage(msg, "Select a valid pending bill from the suggestions list.", true);
      return;
    }

    try {
      await api("/transactions", { method: "POST", body: { billId, amountCollected, discountAmount, mode } });
      showMessage(
        msg,
        Number(discountAmount) > 0
          ? `Payment recorded — ${formatCurrency(amountCollected)} collected plus ${formatCurrency(discountAmount)} discount applied.`
          : "Payment recorded.",
        false
      );
      billCombobox.clear();
      document.getElementById("tx-amount").value = "";
      document.getElementById("tx-discount").value = "0";
      await loadBills();
    } catch (err) {
      showMessage(msg, err.message, true);
    }
  });
});

const settleSubmitBtn = document.getElementById("settle-submit-btn");
settleSubmitBtn.addEventListener("click", async () => {
  await submitOnce(settleSubmitBtn, async () => {
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
});

document.getElementById("download-my-bills-pdf").addEventListener("click", () => {
  const activeBills = myBillsCache.filter((b) => b.status !== "refunded");
  const refundedCount = myBillsCache.length - activeBills.length;

  const rows = myBillsCache.map((b) => {
    const collected = getCollectedAmount(b);
    return [
      b.billNumber,
      b.client.name,
      b.category ? b.category.name : "—",
      b.company ? b.company.name : "—",
      b.location ? b.location.name : "—",
      formatCurrency(b.netAmount),
      formatCurrency(collected),
      formatCurrency(b.discountAmount),
      formatCurrency(b.balance),
      statusLabel(b.status),
      formatDateTime(b.createdAt),
    ];
  });

  if (activeBills.length) {
    rows.push([
      `Total (${activeBills.length} bills${refundedCount ? `, ${refundedCount} refunded excluded` : ""})`,
      "", "", "", "",
      formatCurrency(myBillsTotals.net),
      formatCurrency(myBillsTotals.collected),
      formatCurrency(myBillsTotals.discount),
      formatCurrency(myBillsTotals.outstanding),
      "", "",
    ]);
  }

  downloadPdfReport({
    title: "My Bills",
    subtitle: `Generated ${formatDateTime(new Date())} — bills you personally created`,
    sections: [
      {
        headers: ["Bill #", "Client", "Category", "Company", "Location", "Net Amount", "Collected", "Discount", "Balance", "Status", "Created"],
        rows,
      },
    ],
    filename: `my-bills_${getTodayIstDateString()}.pdf`,
  });
});

init();
