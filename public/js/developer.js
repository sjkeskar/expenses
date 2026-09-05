let currentUserId = null;

async function init() {
  const user = await guardPage("developer");
  if (!user) return;
  currentUserId = user.id;
  document.getElementById("user-name").textContent = `${user.name} (developer)`;

  const reminder = sessionStorage.getItem("sessionReminder");
  if (reminder) {
    const banner = document.getElementById("reminder");
    banner.textContent = reminder;
    banner.style.display = "block";
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  setupChangePasswordModal();
  await loadUsers();
}

async function loadUsers() {
  const { users } = await api("/users");
  const tbody = document.querySelector("#users-table tbody");

  tbody.innerHTML = users
    .map((u) => {
      const status = u.isDeleted
        ? `Deactivated`
        : "Active";
      const actions = [];

      if (!u.isDeleted) {
        if (u.role === "operator") {
          actions.push(`<button class="secondary" data-action="promote" data-id="${u.id}">Promote to Admin</button>`);
        }
        if (u.role === "admin") {
          actions.push(`<button class="secondary" data-action="demote" data-id="${u.id}">Demote to Operator</button>`);
        }
        if (u.id !== currentUserId) {
          actions.push(`<button class="danger" data-action="deactivate" data-id="${u.id}">Deactivate</button>`);
        }
      }

      return `<tr>
        <td>${u.name}</td>
        <td><span class="badge role-${u.role}">${u.role}</span></td>
        <td>${status}</td>
        <td>${formatDateTime(u.createdAt)}</td>
        <td>${actions.join(" ") || "—"}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.id));
  });
}

async function handleAction(action, id) {
  const msg = document.getElementById("action-msg");
  try {
    if (action === "promote") {
      await api(`/users/${id}/promote`, { method: "PATCH" });
      showMessage(msg, "User promoted to admin.", false);
    } else if (action === "demote") {
      await api(`/users/${id}/demote`, { method: "PATCH" });
      showMessage(msg, "User demoted to operator.", false);
    } else if (action === "deactivate") {
      if (!confirm("Deactivate this user? This is a soft delete and can be reversed only in the database.")) {
        return;
      }
      await api(`/users/${id}`, { method: "DELETE" });
      showMessage(msg, "User deactivated.", false);
    }
    await loadUsers();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
}

document.getElementById("create-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-name").value.trim();
  const password = document.getElementById("new-password").value;
  const role = document.getElementById("new-role").value;
  const msg = document.getElementById("create-msg");

  try {
    const { user } = await api("/users", { method: "POST", body: { name, password, role } });
    showMessage(msg, `User "${user.name}" created as ${user.role}.`, false);
    document.getElementById("new-name").value = "";
    document.getElementById("new-password").value = "";
    await loadUsers();
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

init();
