// Price lists (pivot.md §4.5): a panel's standing rates or a camp's rates for
// its scheduled period. Custom prices for listed items, and an optional % off
// the catalog price for everything else. Edited by the lead only; quotes and
// bills snapshot their prices, so an edit affects new documents only.
const { parseMoney, fromPaise } = require("../utils/money");
const { HOME_VISIT_CODE } = require("./billing");

// Body: { discountPercent?, items?: [{ catalogItemId, price }] }.
// Returns null when both are empty (no special rates).
async function parsePriceList(tx, { discountPercent, items = [] } = {}) {
  const percent = discountPercent === undefined || discountPercent === null || discountPercent === "" ? null : Number(discountPercent);
  if (percent !== null && !(percent >= 0 && percent <= 100)) throw { status: 400, message: "discountPercent must be between 0 and 100." };
  if (!Array.isArray(items)) throw { status: 400, message: "items must be a list." };

  const ids = items.map((i) => i.catalogItemId);
  if (new Set(ids).size !== ids.length) throw { status: 400, message: "Each item can only have one special price." };
  const found = await tx.catalogItem.count({ where: { id: { in: ids }, status: "active", code: { not: HOME_VISIT_CODE } } });
  if (found !== ids.length) throw { status: 400, message: "Special prices must be for active catalog items." };

  const rows = items.map((i) => ({ catalogItemId: i.catalogItemId, price: fromPaise(parseMoney(i.price, "price", { required: true })) }));
  return percent === null && rows.length === 0 ? null : { discountPercent: percent, rows };
}

// Replaces the list `existingId` points at (or creates one) and returns the
// id to store, or null to clear it.
async function writePriceList(tx, existingId, parsed) {
  if (!parsed) return null;
  const data = { discountPercent: parsed.discountPercent, items: { create: parsed.rows } };
  if (!existingId) return (await tx.priceList.create({ data })).id;
  await tx.priceList.update({ where: { id: existingId }, data: { ...data, items: { deleteMany: {}, create: parsed.rows } } });
  return existingId;
}

module.exports = { parsePriceList, writePriceList };
