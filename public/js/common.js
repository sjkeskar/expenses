// Shared helpers used by every page script. No build step, no framework —
// plain functions attached to `window`. Feature UI shared between role
// pages lives alongside: billing.js (operator + admin) and analytics.js
// (admin + accountant).

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

// Start-up shared by every role page: checks the session, then wires the
// header (user name, session reminder banner, logout, change password).
// Returns the user, or null when guardPage is redirecting away.
async function initRolePage(role) {
  const user = await guardPage(role);
  if (!user) return null;
  document.getElementById("user-name").textContent = `${user.name} (${role})`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();
  return user;
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "login.html";
  }
}

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

// Table rows are built as arrays of cells so the same row can feed both
// innerHTML and a PDF export. A cell is a plain value (escaped for HTML,
// used as-is in a PDF) or { html, text } when the two must differ.
function tableRowHtml(cells) {
  return `<tr>${cells.map((c) => `<td>${typeof c === "object" ? c.html : escapeHtml(c)}</td>`).join("")}</tr>`;
}

function cellText(cell) {
  return typeof cell === "object" ? cell.text : cell;
}

function statusCell(status) {
  return { html: `<span class="badge ${escapeHtml(status)}">${statusLabel(status)}</span>`, text: statusLabel(status) };
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

// Escapes a value for safe interpolation into an HTML string.
//
// Every table and dropdown in this app is rendered by building an HTML
// string and assigning it to innerHTML, and the values going into those
// strings are names a user typed — client, location, category, company,
// user. Interpolating them raw meant a client literally named
// `<img src=x onerror=...>` executed that script in every operator's,
// admin's and accountant's browser the moment they opened a page listing
// it (see bugs/Closed/BUG-004).
//
// So any user-typed text interpolated into innerHTML goes through this.
// Amounts and dates don't need it — they go through formatCurrency /
// formatDateTime, which only ever produce digits and punctuation — but
// escaping them anyway would be harmless.
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
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
  let hideTimer; // pending "hide the list" timer from the last blur, if any
  let notifiedId = null; // id onSelect was last fired for

  // Hides the list now, and cancels any pending delayed hide.
  function hide() {
    clearTimeout(hideTimer);
    dropdown.style.display = "none";
    input.setAttribute("aria-expanded", "false");
  }

  function filterItems(query) {
    const q = query.trim().toLowerCase();
    if (!q) return currentItems;
    return currentItems.filter((item) => renderLabel(item).toLowerCase().includes(q));
  }

  function render(filtered) {
    visibleItems = filtered.slice(0, 20);
    activeIndex = -1;

    if (!visibleItems.length) {
      dropdown.innerHTML = "";
      hide();
      return;
    }
    dropdown.innerHTML = visibleItems
      .map(
        (item, i) => `
        <div class="combobox-item" role="option" id="${input.id}-opt-${i}" data-index="${i}" data-id="${escapeHtml(item.id)}">
          <span>${escapeHtml(renderLabel(item))}</span>
          ${renderSub ? `<span class="combobox-sub">${escapeHtml(renderSub(item))}</span>` : ""}
        </div>`
      )
      .join("");
    clearTimeout(hideTimer);
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

  // Records a selection and tells the caller about it — but only when the
  // selected item actually CHANGED.
  //
  // Typing a company's full name and pressing Enter is two separate
  // events, and both used to fire onSelect for the same item: the `input`
  // handler on the last keystroke (it found an exact match) and then
  // commit() on the Enter. For the settle picker that meant two
  // GET /companies/:id/outstanding calls, and the second response
  // re-rendered the checklist from scratch — silently wiping any bill the
  // operator had already ticked (see bugs/Open/BUG-019).
  //
  // So onSelect means "the selected id changed", not "something was
  // committed". All of its callers are idempotent per-id loads (the
  // credit-category hint, the reassign history, the settle list, the
  // client ledger), which is the behaviour they already wanted. The
  // trade-off: re-picking the item that is already selected no longer
  // forces a refresh.
  function notifySelection(item) {
    hiddenInput.value = item.id;
    if (item.id === notifiedId) return;
    notifiedId = item.id;
    if (onSelect) onSelect(item);
  }

  // No valid selection any more. Resetting notifiedId here is what lets
  // the SAME item be selected again later and still notify — which the
  // settle flow depends on, since it calls clear() after a successful
  // settlement and the operator may well pick that company again.
  function clearSelection() {
    hiddenInput.value = "";
    notifiedId = null;
  }

  // Commits a selection (by keyboard or mouse) — fills both the visible
  // text field and the hidden id, fires onSelect, and closes the dropdown.
  function commit(item) {
    input.value = renderLabel(item);
    notifySelection(item);
    hide();
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
  // A combobox's popup must say what it is, and the input must point at
  // it — without both, a screen reader announces the field as a plain
  // text box and never reads the suggestions (see bugs/Open/BUG-014).
  // aria-expanded and aria-activedescendant were already handled above.
  dropdown.setAttribute("role", "listbox");
  input.setAttribute("aria-controls", dropdown.id);
  // Chrome makes a scrollable element a Tab stop of its own, so once the
  // list was long enough to scroll, Tab moved focus into the list instead
  // of on to the next field and the operator lost their place (see
  // bugs/Open/BUG-018). Mouse scrolling is unaffected by this.
  dropdown.tabIndex = -1;

  input.addEventListener("input", () => {
    clearTimeout(hideTimer);
    const filtered = filterItems(input.value);
    render(filtered);

    const exact = currentItems.find(
      (item) => renderLabel(item).toLowerCase() === input.value.trim().toLowerCase()
    );
    if (exact) {
      notifySelection(exact);
    } else {
      clearSelection();
    }
  });

  input.addEventListener("focus", () => {
    clearTimeout(hideTimer);
    render(filterItems(input.value));
  });

  input.addEventListener("blur", () => {
    // Delay so a click on a suggestion registers before the list hides.
    //
    // The timer id is kept so that re-focusing the field (or typing in it)
    // within the 150ms cancels it. Without that, a blur followed quickly
    // by a focus left a stale timer that fired afterwards and closed the
    // list the operator was already looking at (see bugs/Open/BUG-009).
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // Belt and braces: if focus has come back to the field in the
      // meantime, there is nothing to hide.
      if (document.activeElement === input) return;
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
      // Hide immediately rather than waiting out the blur delay. That
      // delay exists only so a mouse click on a suggestion lands before
      // the list disappears; a Tab press needs no grace period, and
      // leaving the list up means Tab appears to move focus nowhere.
      hide();
    } else if (e.key === "Escape") {
      if (!isOpen) return;
      e.preventDefault();
      hide();
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
      clearSelection();
    },
  };
}

// The button that submitted this form: e.submitter for a real click and,
// per the HTML spec, for implicit submission with Enter too. The fallback
// finds the form's default submit button, so submitOnce below can never
// trip over a null submitter.
// The lookup lists behind the app's comboboxes. Each list feeds every
// combobox registered for it (via comboboxById's `lookup`), so reloading a
// list — e.g. clients after a bill adds one — refreshes all its pickers.
const lookupComboboxes = { clients: [], locations: [], categories: [], companies: [] };

async function loadLookup(list) {
  const data = await api(`/${list}`); // responds { [list]: [...] }
  lookupComboboxes[list].forEach((combobox) => combobox.updateItems(data[list]));
}

// attachCombobox for the standard markup: #{prefix}-input, #{prefix}-dropdown
// and the hidden #{prefix}-id. `lookup` names the list that feeds it, if any.
function comboboxById(prefix, { lookup, ...options }) {
  const combobox = attachCombobox({
    input: document.getElementById(`${prefix}-input`),
    dropdown: document.getElementById(`${prefix}-dropdown`),
    hiddenInput: document.getElementById(`${prefix}-id`),
    items: [],
    ...options,
  });
  if (lookup) lookupComboboxes[lookup].push(combobox);
  return combobox;
}

function submitButtonFor(e) {
  return (
    e.submitter ||
    (e.target &&
      e.target.querySelector('button[type="submit"], button:not([type]), input[type="submit"]'))
  );
}

// Runs `run` with `button` disabled for the duration, and drops the call
// entirely if the button is already disabled.
//
// That is what makes a double-click on Create Bill or Record Payment
// create one record instead of two (see bugs/Open/BUG-010): a disabled
// button fires no further click or submit event, so the second click of a
// double-click never reaches a handler. The button is re-enabled in a
// `finally`, so a validation failure or a server error still leaves the
// form usable.
//
// The server-side row locks added for BUG-011 close the matching window
// on the API side; this is the half the operator actually sees.
async function submitOnce(button, run) {
  if (button) {
    if (button.disabled) return;
    button.disabled = true;
  }
  try {
    await run();
  } finally {
    if (button) button.disabled = false;
  }
}

// Shared keyboard behaviour for the app's modals (see bugs/Open/BUG-015).
//
// The modals are a plain `.modal-overlay` > `.modal-box` pair toggled with
// style.display, and that is all they were: nothing announced them as a
// dialog, focus stayed behind on the page, Tab walked straight out into
// the page underneath, Escape did nothing, and closing left focus
// nowhere. This adds the five things a dialog owes a keyboard user:
//
//   1. role="dialog" + aria-modal="true", labelled by the box's own <h2>
//   2. focus moves to the first control on open
//   3. Tab (and Shift+Tab) wrap within the dialog instead of escaping it
//   4. Escape closes it
//   5. focus returns to whatever opened it
//
// Native <dialog> + showModal() would give 2-5 for free and is the better
// long-term shape, but it would mean reworking .modal-overlay/.modal-box
// onto ::backdrop and re-baselining every modal screenshot — see the
// "Divergences" note in bugs/FIX-PLAN.md. This keeps the existing CSS and
// backdrop-click-to-close exactly as they are.
//
// Returns { open(opener), close() }. `opener` is the element focus should
// return to; it defaults to whatever was focused when open() was called.
function setupModal(modal, { onClose } = {}) {
  const box = modal.querySelector(".modal-box") || modal;
  let lastFocused = null;

  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  const heading = box.querySelector("h2");
  if (heading) {
    if (!heading.id) heading.id = `${modal.id}-title`;
    box.setAttribute("aria-labelledby", heading.id);
  }

  const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    'input:not([disabled]):not([type="hidden"])',
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  // Only controls that are actually on screen — a hidden one would be a
  // dead stop in the Tab cycle. offsetParent is null for anything inside
  // a display:none subtree, which is how these modals are hidden.
  function focusable() {
    return Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  }

  function close() {
    modal.style.display = "none";
    if (onClose) onClose();
    const opener = lastFocused;
    lastFocused = null;
    if (opener && typeof opener.focus === "function") opener.focus();
  }

  function open(opener) {
    lastFocused = opener || document.activeElement;
    modal.style.display = "flex";
    const items = focusable();
    if (items.length) {
      items[0].focus();
    } else {
      // Nothing focusable (shouldn't happen) — still move focus in, so
      // Escape below has somewhere to fire from.
      box.tabIndex = -1;
      box.focus();
    }
  }

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;

    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return { open, close };
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

  const dialog = setupModal(modal, {
    onClose: () => {
      form.reset();
      msg.textContent = "";
      msg.className = "msg";
    },
  });

  openBtn.addEventListener("click", () => {
    msg.textContent = "";
    msg.className = "msg";
    dialog.open(openBtn);
  });

  cancelBtn.addEventListener("click", () => dialog.close());

  // Click on the dimmed backdrop (not the box itself) also closes it.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) dialog.close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = modal.querySelector("#current-password").value;
    const newPassword = modal.querySelector("#new-password").value;
    const confirmPassword = modal.querySelector("#confirm-new-password").value;

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
