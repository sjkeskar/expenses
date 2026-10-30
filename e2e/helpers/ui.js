// Helpers for driving antd components the way a person does.

// Opens the antd Select labelled `label` and clicks `option`. antd renders
// a hidden, zero-size role="option" list for screen readers next to the
// visible items, which carry the option's text as their title — so the
// visible one is found by title, inside the open dropdown. A searchable
// Select is typed into first: its list is virtual, so an option far down
// isn't rendered until the search narrows the list.
// `within` narrows where the label is looked for (e.g. a dialog).
async function chooseOption(page, label, option, within = page) {
  const input = within.getByLabel(label, { exact: true });
  await input.click();
  if (await input.isEditable()) await input.fill(option);
  await page.locator(".ant-select-dropdown:visible").getByTitle(option, { exact: true }).click();
}

// Adds a catalog item to a quote or bill by its code, through the search box.
async function addItem(page, code) {
  const input = page.getByLabel("Add a test, profile or service");
  await input.click();
  await input.fill(code);
  await page.locator(`.ant-select-dropdown:visible [title^="${code} · "]`).click();
}

// Picks `item` ("Change password", "Sign out") from the account menu in the header.
async function accountMenu(page, item) {
  await page.getByRole("banner").getByRole("button", { name: /^Account: / }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

module.exports = { chooseOption, addItem, accountMenu };
