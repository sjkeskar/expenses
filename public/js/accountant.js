// Accountant page: the shared Analytics UI (analytics.js), read-only.
async function init() {
  if (!(await initRolePage("accountant"))) return;
  initAnalytics();
  await loadLookup("clients");
  await loadAnalytics();
}

init();
