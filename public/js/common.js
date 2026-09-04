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

  function filterItems(query) {
    const q = query.trim().toLowerCase();
    if (!q) return currentItems;
    return currentItems.filter((item) => renderLabel(item).toLowerCase().includes(q));
  }

  function render(filtered) {
    if (!filtered.length) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }
    dropdown.innerHTML = filtered
      .slice(0, 20)
      .map(
        (item) => `
        <div class="combobox-item" data-id="${item.id}">
          <span>${renderLabel(item)}</span>
          ${renderSub ? `<span class="combobox-sub">${renderSub(item)}</span>` : ""}
        </div>`
      )
      .join("");
    dropdown.style.display = "block";
  }

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
    }, 150);
  });

  dropdown.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".combobox-item");
    if (!el) return;
    const item = currentItems.find((i) => i.id === el.dataset.id);
    if (item) {
      input.value = renderLabel(item);
      hiddenInput.value = item.id;
      if (onSelect) onSelect(item);
    }
    dropdown.style.display = "none";
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
