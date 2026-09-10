// Shared helpers used by login.js / operator.js / admin.js / developer.js.
// No build step, no framework — plain functions attached to `window`.

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // no JSON body
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// Confirms the logged-in user's role matches what this page expects.
// Redirects to login.html if not authenticated, or to the correct role
// page if the session belongs to a different role.
async function guardPage(expectedRole) {
  try {
    const { user } = await api("/auth/me");
    if (user.role !== expectedRole) {
      window.location.href = `${user.role}.html`;
      return null;
    }
    return user;
  } catch (err) {
    window.location.href = "login.html";
    return null;
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "login.html";
  }
}

function formatCurrency(value) {
  const num = Number(value);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value) {
  // Always display in IST, regardless of what timezone the browser/OS on
  // this particular PC happens to be set to. The backend already stores
  // and computes everything in IST terms — the frontend should never
  // silently reinterpret that through a different local timezone.
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  // Date-only counterpart of formatDateTime, for calendar-day displays
  // (analytics tables) where only the day matters, not the time.
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// 'YYYY-MM-DD' for today in IST — used to default date pickers (bill
// date, analytics range) to the correct calendar day regardless of the
// browser/OS's own timezone setting.
function getTodayIstDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function showMessage(el, text, isError) {
  el.textContent = text;
  el.className = "msg " + (isError ? "error" : "success");
}

// Generic typeable/filterable combobox: a text input backed by a hidden
// input (holding the matched item's id) and a suggestion dropdown.
//
// - As the user types, the list filters to matching items and an exact
//   (case-insensitive) match auto-fills the hidden id.
// - Clicking a suggestion selects it and fills both fields.
// - If nothing matches, the hidden id stays empty — callers decide what
//   that means (e.g. "create a new client with this name" vs "invalid,
//   please pick an existing bill").
//
// items: array of { id, ...whatever renderLabel/renderSub need }
function attachCombobox({ input, dropdown, hiddenInput, items, renderLabel, renderSub, onSelect }) {
  let currentItems = items;
  let visibleItems = []; // whatever's actually rendered in the dropdown right now
  let activeIndex = -1; // keyboard-highlighted row, -1 = none

  function filterItems(query) {
    const q = query.trim().toLowerCase();
    if (!q) return currentItems;
    return currentItems.filter((item) => renderLabel(item).toLowerCase().includes(q));
  }

  function render(filtered) {
    visibleItems = filtered.slice(0, 20);
    activeIndex = -1;

    if (!visibleItems.length) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      return;
    }
    dropdown.innerHTML = visibleItems
      .map(
        (item, i) => `
        <div class="combobox-item" role="option" id="${input.id}-opt-${i}" data-index="${i}" data-id="${item.id}">
          <span>${renderLabel(item)}</span>
          ${renderSub ? `<span class="combobox-sub">${renderSub(item)}</span>` : ""}
        </div>`
      )
      .join("");
    dropdown.style.display = "block";
    input.setAttribute("aria-expanded", "true");
  }

  // Reflects `activeIndex` onto the DOM (highlight class + aria-selected)
  // and scrolls the highlighted row into view for long lists.
  function paintActive() {
    const rows = dropdown.querySelectorAll(".combobox-item");
    rows.forEach((row, i) => {
      const isActive = i === activeIndex;
      row.classList.toggle("active", isActive);
      row.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) row.scrollIntoView({ block: "nearest" });
    });
    input.setAttribute("aria-activedescendant", activeIndex >= 0 ? `${input.id}-opt-${activeIndex}` : "");
  }

  // Commits a selection (by keyboard or mouse) — fills both the visible
  // text field and the hidden id, fires onSelect, and closes the dropdown.
  function commit(item) {
    input.value = renderLabel(item);
    hiddenInput.value = item.id;
    if (onSelect) onSelect(item);
    dropdown.style.display = "none";
    input.setAttribute("aria-expanded", "false");
  }

  // What Enter/Tab should commit when nothing's been arrow-key-highlighted
  // yet: the highlighted row if there is one, otherwise the sole visible
  // match if typing has narrowed it down to exactly one — so a fast typist
  // who typed enough characters to uniquely match doesn't have to also
  // press an arrow key first.
  function resolveSelection() {
    if (activeIndex >= 0 && visibleItems[activeIndex]) return visibleItems[activeIndex];
    if (visibleItems.length === 1) return visibleItems[0];
    return null;
  }

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");

  input.addEventListener("input", () => {
    hiddenInput.value = "";
    const filtered = filterItems(input.value);
    render(filtered);

    const exact = currentItems.find(
      (item) => renderLabel(item).toLowerCase() === input.value.trim().toLowerCase()
    );
    if (exact) {
      hiddenInput.value = exact.id;
      if (onSelect) onSelect(exact);
    }
  });

  input.addEventListener("focus", () => {
    render(filterItems(input.value));
  });

  input.addEventListener("blur", () => {
    // Delay so a click on a suggestion registers before the list hides.
    setTimeout(() => {
      dropdown.style.display = "none";
      input.setAttribute("aria-expanded", "false");
    }, 150);
  });

  input.addEventListener("keydown", (e) => {
    const isOpen = dropdown.style.display !== "none" && visibleItems.length > 0;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        render(filterItems(input.value)); // reopen suggestions from keyboard alone
        return;
      }
      activeIndex = Math.min(activeIndex + 1, visibleItems.length - 1);
      paintActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      paintActive();
    } else if (e.key === "Enter") {
      if (!isOpen) return; // let the form submit normally
      const selection = resolveSelection();
      if (selection) {
        e.preventDefault();
        commit(selection);
      }
      // No resolvable selection (still ambiguous, multiple matches, none
      // highlighted): don't block Enter — let the browser's normal
      // required-field validation handle an incomplete/invalid form
      // rather than silently swallowing the keypress.
    } else if (e.key === "Tab") {
      // Committing on Tab too (not just Enter) means a keyboard-only
      // operator can just keep tabbing through a form without having to
      // remember to press Enter first on every combobox field.
      if (!isOpen) return;
      const selection = resolveSelection();
      if (selection) commit(selection);
    } else if (e.key === "Escape") {
      if (!isOpen) return;
      e.preventDefault();
      dropdown.style.display = "none";
      input.setAttribute("aria-expanded", "false");
    }
  });

  dropdown.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".combobox-item");
    if (!el) return;
    const item = visibleItems[Number(el.dataset.index)];
    if (item) commit(item);
  });

  return {
    // Called after re-fetching data (e.g. a new client/bill list) so the
    // combobox filters against fresh data without re-attaching listeners.
    updateItems(newItems) {
      currentItems = newItems;
    },
    clear() {
      input.value = "";
      hiddenInput.value = "";
    },
  };
}

// Wires up the shared "Change Password" modal (markup duplicated across
// operator.html / admin.html / developer.html, logic centralized here).
// Safe to call on any page — does nothing if the modal's elements aren't
// present, so pages that don't include the modal aren't affected.
function setupChangePasswordModal() {
  const openBtn = document.getElementById("change-password-btn");
  const modal = document.getElementById("change-password-modal");
  const cancelBtn = document.getElementById("change-password-cancel");
  const form = document.getElementById("change-password-form");
  const msg = document.getElementById("change-password-msg");

  if (!openBtn || !modal || !form || !msg) return;

  function closeModal() {
    modal.style.display = "none";
    form.reset();
    msg.textContent = "";
    msg.className = "msg";
  }

  openBtn.addEventListener("click", () => {
    msg.textContent = "";
    msg.className = "msg";
    modal.style.display = "flex";
  });

  cancelBtn.addEventListener("click", closeModal);

  // Click on the dimmed backdrop (not the box itself) also closes it.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-new-password").value;

    if (newPassword !== confirmPassword) {
      showMessage(msg, "New password and confirmation do not match.", true);
      return;
    }

    try {
      await api("/auth/password", { method: "PATCH", body: { currentPassword, newPassword } });
      form.reset();
      showMessage(msg, "Password changed. Redirecting you to log in again with it...", false);
      // The backend already destroyed the session — don't just close the
      // modal, actually navigate away, since every other API call on this
      // page would now fail with 401 anyway. sessionStorage carries the
      // confirmation message across the redirect so login.html can show it.
      sessionStorage.setItem(
        "passwordChangedNotice",
        "Your password was changed. Please log in with your new password."
      );
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1200);
    } catch (err) {
      showMessage(msg, err.message, true);
    }
  });
}

// Exports one or more tables into a single downloadable PDF. Runs
// entirely in the browser (jsPDF + its autotable plugin, both self-hosted
// under public/vendor/ — no server round-trip, no CDN dependency).
//
// sections: [{ heading?, headers: [...], rows: [[...], ...] }, ...]
// Multiple sections stack top-to-bottom in one PDF (used for the
// per-client detail export, which combines two tables into one report).
function downloadPdfReport({ title, subtitle, sections, filename }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(14);
  doc.setTextColor(20, 35, 31);
  doc.text(title, 14, 16);

  let cursorY = 22;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(93, 107, 103);
    doc.text(subtitle, 14, cursorY);
    cursorY += 6;
  }

  sections.forEach((section) => {
    if (section.heading) {
      doc.setFontSize(11);
      doc.setTextColor(20, 35, 31);
      doc.text(section.heading, 14, cursorY + 4);
      cursorY += 8;
    }
    doc.autoTable({
      startY: cursorY,
      head: [section.headers],
      body: section.rows,
      styles: { fontSize: 9, textColor: [23, 35, 31] },
      headStyles: { fillColor: [31, 110, 92], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [244, 247, 245] },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  });

  doc.save(filename);
}
