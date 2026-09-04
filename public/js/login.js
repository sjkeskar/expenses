document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  const password = document.getElementById("password").value;
  const msg = document.getElementById("msg");

  try {
    const { user } = await api("/auth/login", { method: "POST", body: { name, password } });
    // Session reminder is shown on the landing page instead of here, via
    // sessionStorage, so it survives the redirect.
    sessionStorage.setItem(
      "sessionReminder",
      "Your session stays active for 4 hours. Please log out if you step away from this PC."
    );
    window.location.href = `${user.role}.html`;
  } catch (err) {
    showMessage(msg, err.message, true);
  }
});

// If already logged in, skip straight to the right page.
(async () => {
  try {
    const { user } = await api("/auth/me");
    window.location.href = `${user.role}.html`;
  } catch (_) {
    // not logged in — stay on the login page
  }
})();
