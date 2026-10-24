// Billing UI shared by operator.html and admin.html's Billing tab, which
// carry identical markup and element ids: Create Bill, Record Payment,
// Settle Company Balance, My Bills + Refund. The page calls
// initBilling(user) once guardPage has let it through.

let currentUserId = null;
let myBillsCache = [];
let myBillsTotals = { billed: 0, net: 0, collected: 0, discount: 0, outstanding: 0 };
let clientCombobox, locationCombobox, categoryCombobox, billCombobox, settleCompanyCombobox;
let settleLoadToken = 0; // increments per settle-list load, so a stale response can be dropped
let pendingRefundBillId = null;
let refundDialog = null; // { open, close } from setupModal — see common.js

async function initBilling(user) {
  currentUserId = user.id;
  setupRefundModal();
  setupBillingComboboxes();
  document.getElementById("bill-date").value = getTodayIstDateString();
  for (const list of ["clients", "locations", "categories", "companies"]) await loadLookup(list);
  await loadBills();
}

function setupBillingComboboxes() {
  clientCombobox = comboboxById("bill-client", { lookup: "clients", renderLabel: (c) => c.name });
  locationCombobox = comboboxById("bill-location", {
    lookup: "locations",
    renderLabel: (l) => l.name,
    renderSub: (l) => `Code: ${l.locationCode}`,
  });
  categoryCombobox = comboboxById("bill-category", {
    lookup: "categories",
    renderLabel: (c) => c.name,
    renderSub: (c) => (c.type === "credit" && c.company ? `Credit — ${c.company.name}` : "Standard"),
    onSelect: showCategoryInfo,
  });
  document.getElementById("bill-category-input").addEventListener("input", () => {
    if (!document.getElementById("bill-category-id").value) showCategoryInfo(null);
  });
  // Fed by loadBills() with pending bills only, not by a lookup list.
  billCombobox = comboboxById("tx-bill", {
    renderLabel: (b) => `${b.billNumber} — ${b.client.name}`,
    renderSub: (b) => `Balance: ${formatCurrency(b.balance)}`,
  });
  settleCompanyCombobox = comboboxById("settle-company", {
    lookup: "companies",
    renderLabel: (c) => c.name,
    onSelect: (company) => loadSettleBillsList(company.id),
  });
}

function showCategoryInfo(category) {
  document.getElementById("bill-category-info").textContent =
    category && category.type === "credit" && category.company
      ? `Credit bill — will be billed to ${category.company.name}.`
      : "";
}

// ---------- Settle Company Balance ----------

async function loadSettleBillsList(companyId) {
  const container = document.getElementById("settle-bills-container");
  const tbody = document.querySelector("#settle-bills-table tbody");

  // Which bills are ticked right now. Re-rendering this list rebuilds the
  // checkboxes from scratch, so without carrying these over any reload
  // throws the operator's selection away (see bugs/Closed/BUG-019). Ids
  // from a different company simply won't match, so switching company
  // still starts clean.
  const ticked = new Set(
    Array.from(tbody.querySelectorAll(".settle-bill-checkbox:checked")).map((cb) => cb.dataset.id)
  );

  // Loads aren't otherwise sequenced: pick company A then quickly company
  // B, and a late response for A would paint over B's list. Only the most
  // recently started load is allowed to render.
  const token = ++settleLoadToken;

  try {
    const { pendingBills } = await api(`/companies/${companyId}/outstanding`);
    if (token !== settleLoadToken) return;

    tbody.innerHTML = pendingBills
      .map(
        (b) => `
        <tr>
          <td><input type="checkbox" class="settle-bill-checkbox" data-id="${escapeHtml(b.id)}" data-balance="${escapeHtml(b.balance)}" aria-label="Settle bill ${escapeHtml(b.billNumber)} — ${escapeHtml(b.client.name)}"${ticked.has(b.id) ? " checked" : ""} /></td>
          <td>${escapeHtml(b.billNumber)}</td>
          <td>${escapeHtml(b.client.name)}</td>
          <td>${formatCurrency(b.balance)}</td>
          <td>${formatDateTime(b.createdAt)}</td>
        </tr>`
      )
      .join("");
    tbody.querySelectorAll(".settle-bill-checkbox").forEach((cb) => cb.addEventListener("change", updateSettleTotal));
    container.style.display = "block";

    if (pendingBills.length === 0) {
      document.getElementById("settle-total-info").textContent = "This company has no outstanding bills.";
    } else {
      updateSettleTotal();
    }
  } catch (err) {
    if (token !== settleLoadToken) return;
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

// ---------- Refund ----------

function openRefundModal(bill, opener) {
  pendingRefundBillId = bill.id;
  document.getElementById("refund-modal-details").textContent =
    `Bill ${bill.billNumber} — ${bill.client.name}. Amount paid so far: ${formatCurrency(getCollectedAmount(bill))}. Confirm this amount has been refunded to the client?`;
  const msg = document.getElementById("refund-modal-msg");
  msg.textContent = "";
  msg.className = "msg";
  refundDialog.open(opener);
}

function setupRefundModal() {
  const modal = document.getElementById("refund-modal");
  // setupModal's close() also restores focus to whatever opened the modal.
  refundDialog = setupModal(modal, { onClose: () => (pendingRefundBillId = null) });

  document.getElementById("refund-modal-cancel").addEventListener("click", refundDialog.close);
  modal.addEventListener("click", (e) => {
    if (e.target.id === "refund-modal") refundDialog.close();
  });
  document.getElementById("refund-modal-confirm").addEventListener("click", async () => {
    if (!pendingRefundBillId) return;
    try {
      await api(`/bills/${pendingRefundBillId}/refund`, { method: "PATCH" });
      refundDialog.close();
      await loadBills();
    } catch (err) {
      showMessage(document.getElementById("refund-modal-msg"), err.message, true);
    }
  });
}

// ---------- My Bills ----------

// One My Bills row as cells (see tableRowHtml in common.js), shared by the
// on-screen table and its PDF export.
function myBillCells(b) {
  return [
    b.billNumber,
    b.client.name,
    b.category?.name ?? "—",
    b.company?.name ?? "—",
    b.location?.name ?? "—",
    formatCurrency(b.netAmount),
    formatCurrency(getCollectedAmount(b)),
    formatCurrency(b.discountAmount),
    formatCurrency(b.balance),
    statusCell(b.status),
    formatDateTime(b.createdAt),
  ];
}

async function loadBills() {
  const { bills } = await api("/bills"); // full list — Record Payment can top up ANY pending bill, not just your own

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

  const rowsHtml = myBillsCache
    .map((b) => {
      const canRefund = b.status !== "refunded" && getCollectedAmount(b) > 0;
      const actions = canRefund ? `<button class="danger refund-btn" data-id="${escapeHtml(b.id)}">Refund</button>` : "—";
      return tableRowHtml([...myBillCells(b), { html: actions }]);
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

  const tbody = document.querySelector("#bills-table tbody");
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

  billCombobox.updateItems(bills.filter((b) => b.status === "pending"));
}

document.getElementById("download-my-bills-pdf").addEventListener("click", () => {
  const activeBills = myBillsCache.filter((b) => b.status !== "refunded");
  const refundedCount = myBillsCache.length - activeBills.length;
  const rows = myBillsCache.map((b) => myBillCells(b).map(cellText));

  if (activeBills.length) {
    rows.push([
      // Always "bills" here, unlike the on-screen Total row — kept as-is.
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

// ---------- Forms ----------

document.getElementById("bill-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitOnce(submitButtonFor(e), async () => {
    const msg = document.getElementById("bill-msg");
    const value = (id) => document.getElementById(id).value;
    const clientName = value("bill-client-input").trim();
    const clientId = value("bill-client-id");
    const locationId = value("bill-location-id");
    const categoryId = value("bill-category-id");
    const billDate = value("bill-date");
    const initialAmount = value("initial-amount");

    if (!clientName) return showMessage(msg, "Enter a client name.", true);
    if (!billDate) return showMessage(msg, "Select a bill date.", true);
    if (!locationId) return showMessage(msg, "Select a valid location from the suggestions list.", true);
    if (!categoryId) return showMessage(msg, "Select a valid category from the suggestions list.", true);

    const body = {
      originalAmount: value("original-amount"),
      discountAmount: value("discount-amount"),
      billDate,
      locationId,
      categoryId,
      // An exact match picked an existing client; otherwise the server finds-or-creates by name.
      ...(clientId ? { clientId } : { clientName }),
      ...(Number(initialAmount) > 0 && { initialAmountCollected: initialAmount, initialMode: value("initial-mode") }),
    };

    try {
      const { bill } = await api("/bills", { method: "POST", body });
      const companyNote = bill.company ? ` (billed to ${bill.company.name})` : "";
      showMessage(
        msg,
        `Bill ${bill.billNumber} created for ${bill.client.name} — ${bill.category.name}${companyNote} — balance ${formatCurrency(bill.balance)}.`,
        false
      );
      [clientCombobox, locationCombobox, categoryCombobox].forEach((c) => c.clear());
      showCategoryInfo(null);
      document.getElementById("bill-date").value = getTodayIstDateString();
      document.getElementById("original-amount").value = "";
      document.getElementById("discount-amount").value = "0";
      document.getElementById("initial-amount").value = "0";
      await loadLookup("clients");
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

    if (!billId) return showMessage(msg, "Select a valid pending bill from the suggestions list.", true);

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
    const billIds = Array.from(document.querySelectorAll(".settle-bill-checkbox:checked")).map((cb) => cb.dataset.id);

    if (!companyId) return showMessage(msg, "Select a valid company from the suggestions list.", true);
    if (billIds.length === 0) return showMessage(msg, "Check at least one bill to settle.", true);

    try {
      const result = await api(`/companies/${companyId}/settle`, { method: "POST", body: { billIds, mode } });
      const breakdown = result.breakdown.map((b) => `${b.billNumber}: ${formatCurrency(b.amountApplied)}`).join("; ");
      showMessage(msg, `Settled ${formatCurrency(result.totalSettled)} for ${result.company.name}. ${breakdown}`, false);
      settleCompanyCombobox.clear();
      document.getElementById("settle-bills-container").style.display = "none";
      await loadBills();
    } catch (err) {
      showMessage(msg, err.message, true);
      // A settlement is all-or-nothing, and the usual reason it is refused
      // is that the list has gone stale: a ticked bill was paid elsewhere
      // meanwhile ("Bill X is not pending"). Reload the list so it shows
      // what is still owed; loadSettleBillsList keeps the ticks on bills
      // that are still pending and drops the rest, so the operator can
      // simply press Settle again. Re-picking the company can't do this
      // since BUG-019 (it no longer reloads an unchanged selection) — see
      // bugs/Closed/BUG-020.
      await loadSettleBillsList(companyId);
    }
  });
});
