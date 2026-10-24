// Operator page: the shared Billing UI (billing.js) and nothing else.
async function init() {
  const user = await initRolePage("operator");
  if (user) await initBilling(user);
}

init();
