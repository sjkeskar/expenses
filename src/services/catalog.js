// Catalog (pivot.md §4.6): tests, profiles and services. Technicians and
// pathologists propose changes — one at a time or a whole grid batch — and
// the lead approves them; the lead's own changes apply at once. Values are
// validated when proposed and again when applied, since the catalog may
// have moved on in between.
const { LEAD } = require("../middleware/auth");
const { parseMoney, fromPaise } = require("../utils/money");
const { defineApproval, requestApproval } = require("./approvals");
const { HOME_VISIT_CODE } = require("./billing");

// An item as the catalog screens show it.
const CATALOG_DETAIL = {
  draws: { orderBy: { sequence: "asc" } },
  machineSteps: { include: { machineType: { select: { id: true, name: true } } }, orderBy: { sequence: "asc" } },
  components: { include: { test: { select: { id: true, code: true, name: true } } } },
};

const KINDS = ["test", "profile", "service"];
const ACTIONS = ["create", "update", "retire"];
const CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value) => (Array.isArray(value) ? value : []);

// Validates the full values of one item (a grid row) and returns them
// normalised. `current` is the item being edited, whose kind can't change.
async function validateValues(tx, values = {}, current = null) {
  const code = String(values.code ?? "").trim().toUpperCase();
  if (!CODE_REGEX.test(code) || code === HOME_VISIT_CODE) {
    throw { status: 400, message: `"${code}" isn't a valid code: letters, digits and dashes, up to 20.` };
  }
  const clash = await tx.catalogItem.findUnique({ where: { code } });
  if (clash && clash.id !== current?.id) throw { status: 409, message: `Code ${code} is already in use.` };

  const name = text(values.name);
  if (!name) throw { status: 400, message: `${code}: a name is required.` };
  const kind = current ? current.kind : values.kind;
  if (!KINDS.includes(kind)) throw { status: 400, message: `${code}: kind must be test, profile or service.` };
  if (current && values.kind && values.kind !== current.kind) throw { status: 400, message: `${code}: an item's kind can't change.` };

  const draws = list(values.draws).map(text);
  const machineSteps = list(values.machineSteps).map((s) => ({ sequence: Number(s.sequence), machineTypeId: s.machineTypeId }));
  const components = list(values.components);
  if (kind !== "test" && (draws.length || machineSteps.length)) {
    throw { status: 400, message: `${code}: only a test has sample draws and machine steps.` };
  }
  if (kind !== "profile" && components.length) throw { status: 400, message: `${code}: only a profile has component tests.` };

  if (kind === "test") {
    if (!draws.length) draws.push("Single");
    if (draws.includes(null) || new Set(draws).size !== draws.length) {
      throw { status: 400, message: `${code}: each sample draw needs a distinct label.` };
    }
    if (machineSteps.some((s) => !Number.isInteger(s.sequence) || s.sequence < 1)) {
      throw { status: 400, message: `${code}: machine step numbers start at 1.` };
    }
    const typeIds = [...new Set(machineSteps.map((s) => s.machineTypeId))];
    if ((await tx.machineType.count({ where: { id: { in: typeIds }, isActive: true } })) !== typeIds.length) {
      throw { status: 400, message: `${code}: unknown machine type.` };
    }
  }
  if (kind === "profile") {
    if (!components.length || new Set(components).size !== components.length) {
      throw { status: 400, message: `${code}: a profile needs its tests, each listed once.` };
    }
    if ((await tx.catalogItem.count({ where: { id: { in: components }, kind: "test", status: "active" } })) !== components.length) {
      throw { status: 400, message: `${code}: a profile's tests must be active tests in the catalog.` };
    }
  }

  return {
    code,
    name,
    kind,
    price: fromPaise(parseMoney(values.price, `${code}: price`, { required: true })),
    department: text(values.department),
    sampleType: text(values.sampleType),
    container: text(values.container),
    instructions: text(values.instructions),
    draws,
    machineSteps,
    components,
  };
}

// The nested writes for an item's draws, machine steps and components;
// `replace` clears the old ones first (an edit replaces them wholesale).
function children({ draws, machineSteps, components }, replace) {
  const clear = replace ? { deleteMany: {} } : {};
  return {
    draws: { ...clear, create: draws.map((label, i) => ({ sequence: i + 1, label })) },
    machineSteps: { ...clear, create: machineSteps },
    components: { ...clear, create: components.map((testId) => ({ testId })) },
  };
}

async function activeItem(tx, id) {
  const item = id ? await tx.catalogItem.findUnique({ where: { id } }) : null;
  if (!item || item.status !== "active" || item.code === HOME_VISIT_CODE) throw { status: 404, message: "Catalog item not found." };
  return item;
}

// Checks one proposed change and returns its approval payload.
async function validateChange(tx, { action, catalogItemId, values }) {
  if (!ACTIONS.includes(action)) throw { status: 400, message: "action must be create, update or retire." };
  const current = action === "create" ? null : await activeItem(tx, catalogItemId);
  if (current) {
    const pending = await tx.approval.count({ where: { subjectType: "catalog_change", subjectId: current.id, status: "pending" } });
    if (pending) throw { status: 409, message: `${current.code} already has a change waiting for approval.` };
  }
  if (action === "retire") return { action };

  const valid = await validateValues(tx, values, current);
  if (action === "create") {
    const pendingSameCode = await tx.approval.count({
      where: { subjectType: "catalog_change", status: "pending", payload: { path: ["values", "code"], equals: valid.code } },
    });
    if (pendingSameCode) throw { status: 409, message: `A new item with code ${valid.code} is already waiting for approval.` };
  }
  return { action, values: valid };
}

// Applies an approved change.
async function applyChange(tx, approval) {
  const { action, values } = approval.payload;
  if (action === "retire") {
    const item = await activeItem(tx, approval.subjectId);
    const inProfile = await tx.profileComponent.findFirst({
      where: { testId: item.id, profile: { status: "active" } },
      include: { profile: true },
    });
    if (inProfile) throw { status: 409, message: `${item.code} is part of profile ${inProfile.profile.code}; change the profile first.` };
    await tx.catalogItem.update({ where: { id: item.id }, data: { status: "retired" } });
    return;
  }
  const current = action === "update" ? await activeItem(tx, approval.subjectId) : null;
  const { draws, machineSteps, components, ...fields } = await validateValues(tx, values, current);
  const nested = children({ draws, machineSteps, components }, Boolean(current));
  if (current) await tx.catalogItem.update({ where: { id: current.id }, data: { ...fields, ...nested } });
  else await tx.catalogItem.create({ data: { ...fields, ...nested } });
}

defineApproval("catalog_change", { approvers: LEAD, onApprove: applyChange });

// Proposes a batch of changes (a grid submission): all rows are validated
// first and nothing is recorded unless every row is valid; row errors come
// back together so the grid can mark each one.
async function proposeChanges(tx, changes, user) {
  if (!Array.isArray(changes) || changes.length === 0) throw { status: 400, message: "Nothing to submit." };
  const payloads = [];
  const rowErrors = [];
  for (const [row, change] of changes.entries()) {
    try {
      payloads.push(await validateChange(tx, change));
    } catch (err) {
      if (!err.status) throw err;
      rowErrors.push({ row, error: err.message });
    }
  }
  const codes = payloads.filter((p) => p.action !== "retire").map((p) => p.values.code);
  const repeated = codes.find((code, i) => codes.indexOf(code) !== i);
  if (repeated) rowErrors.push({ row: null, error: `Code ${repeated} appears more than once in this batch.` });
  if (rowErrors.length) throw { status: 400, message: "Some rows need fixing.", details: { rows: rowErrors } };

  const approvals = [];
  for (const [i, payload] of payloads.entries()) {
    const subjectId = payload.action === "create" ? null : changes[i].catalogItemId;
    approvals.push(await requestApproval(tx, { subjectType: "catalog_change", subjectId, payload }, user));
  }
  return approvals;
}

module.exports = { CATALOG_DETAIL, proposeChanges };
