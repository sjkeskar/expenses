const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generateBillNumber } = require("../utils/billNumber");
const { VALID_MODES } = require("../utils/paymentModes");
const {
  getIstDateString,
  isValidDateString,
  dateStringToBillNumberKey,
  combineDateWithCurrentIstTime,
} = require("../utils/istDate");

const router = express.Router();

// GET /api/bills — operator + admin.
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const bills = await prisma.bill.findMany({
    include: {
      client: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, type: true } },
      company: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ bills });
});

// GET /api/bills/:id — single bill + its transaction ledger.
router.get("/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const bill = await prisma.bill.findUnique({
    where: { id: req.params.id },
    include: {
      client: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, type: true } },
      company: { select: { id: true, name: true } },
      transactions: {
        where: { isDeleted: false },
        include: { operator: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!bill) return res.status(404).json({ error: "Bill not found." });
  res.json({ bill });
});

// POST /api/bills — operator + admin.
// Body: { clientId?, clientName?, locationId, categoryId, originalAmount, discountAmount?, initialAmountCollected?, initialMode?, billDate? }
//
// locationId is required — must reference an active Location (the fixed,
// admin-managed list of shop locations). Unlike clients, locations are
// NOT find-or-create from free text: the picker only allows selecting an
// existing one, since only admin can add new locations.
//
// categoryId is required — must reference an active Category. Same
// pattern: not find-or-create, admin manages the list. There is NO
// separate companyId field on a bill anymore — if the chosen category's
// type is "credit", the bill's company is copied directly from
// category.companyId (set when the category itself was created). This
// means picking a credit category is enough; there's nothing else to
// select for the company.
//
// Exactly one of clientId / clientName must be given:
// - clientId: use an existing client (from the combobox selecting a match).
// - clientName: find-or-create — looks for a client with this name
//   (case-insensitive, trimmed) and reuses it if found, otherwise creates
//   a new client. This is what powers "type a client name, it's created
//   automatically if new" on the frontend.
//
// If initialAmountCollected is provided and > 0, a payment transaction is
// recorded against the new bill in the SAME database transaction as the
// bill creation — so "create bill + collect payment now" is one atomic
// operation, matching the merged workflow on the frontend.
//
// billDate ('YYYY-MM-DD', IST calendar day) lets a bill be created for
// ANY date, not just today — defaults to today (IST) if omitted. This
// controls both the bill_number's DDMMYYYY prefix and the bill's
// (and, if applicable, its initial payment's) createdAt timestamp, so a
// backdated bill sorts and buckets in analytics under the date it's
// actually for, not the date someone happened to enter it.
router.post("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const {
    clientId,
    clientName,
    originalAmount,
    discountAmount,
    initialAmountCollected,
    initialMode,
    billDate,
    locationId,
    categoryId,
  } = req.body;
  const userId = req.session.user.id;

  if (!clientId && !clientName) {
    return res.status(400).json({ error: "clientId or clientName is required." });
  }
  if (!locationId) {
    return res.status(400).json({ error: "locationId is required." });
  }
  if (!categoryId) {
    return res.status(400).json({ error: "categoryId is required." });
  }
  if (originalAmount === undefined) {
    return res.status(400).json({ error: "originalAmount is required." });
  }

  const resolvedBillDate = billDate || getIstDateString();
  if (!isValidDateString(resolvedBillDate)) {
    return res.status(400).json({ error: "billDate must be a valid date in YYYY-MM-DD format." });
  }

  const original = Number(originalAmount);
  const discount = Number(discountAmount || 0);

  if (!Number.isFinite(original) || original <= 0) {
    return res.status(400).json({ error: "originalAmount must be a positive number." });
  }
  if (!Number.isFinite(discount) || discount < 0) {
    return res.status(400).json({ error: "discountAmount cannot be negative." });
  }
  if (discount > original) {
    return res.status(400).json({ error: "discountAmount cannot exceed originalAmount." });
  }

  const netAmount = original - discount;

  let initialAmount = 0;
  const wantsInitialPayment =
    initialAmountCollected !== undefined && initialAmountCollected !== null && initialAmountCollected !== "";
  if (wantsInitialPayment) {
    initialAmount = Number(initialAmountCollected);
    if (!Number.isFinite(initialAmount) || initialAmount < 0) {
      return res.status(400).json({ error: "initialAmountCollected cannot be negative." });
    }
    if (initialAmount > netAmount) {
      return res.status(400).json({ error: "Amount collected now cannot exceed the bill's net amount." });
    }
    if (initialAmount > 0 && !VALID_MODES.includes(initialMode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let client;
      if (clientId) {
        client = await tx.client.findUnique({ where: { id: clientId } });
        if (!client) {
          throw { status: 404, message: "Client not found." };
        }
      } else {
        const trimmedName = clientName.trim();
        if (!trimmedName) {
          throw { status: 400, message: "Client name cannot be empty." };
        }
        client = await tx.client.findFirst({
          where: { name: { equals: trimmedName, mode: "insensitive" } },
        });
        if (!client) {
          client = await tx.client.create({ data: { name: trimmedName } });
        }
      }

      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location || !location.isActive) {
        throw { status: 400, message: "Select a valid location from the list." };
      }

      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category || !category.isActive) {
        throw { status: 400, message: "Select a valid category from the list." };
      }

      // Company is derived from the category, not chosen independently
      // on the bill form. A credit category always has a companyId set
      // at creation time (enforced in categories.js) — the null check
      // here is just a defensive guard against a misconfigured category.
      let resolvedCompanyId = null;
      if (category.type === "credit") {
        if (!category.companyId) {
          throw {
            status: 400,
            message: "This category has no linked company configured. Please contact an admin to fix it.",
          };
        }
        resolvedCompanyId = category.companyId;
      }

      const billNumberDateKey = dateStringToBillNumberKey(resolvedBillDate);
      const billNumber = await generateBillNumber(tx, billNumberDateKey);
      const billTimestamp = combineDateWithCurrentIstTime(resolvedBillDate);
      const balance = netAmount - initialAmount;

      const bill = await tx.bill.create({
        data: {
          billNumber,
          clientId: client.id,
          originalAmount: original,
          discountAmount: discount,
          netAmount,
          balance,
          status: balance <= 0 ? "fully_paid" : "pending",
          createdById: userId,
          createdAt: billTimestamp,
          locationId: location.id,
          categoryId: category.id,
          companyId: resolvedCompanyId,
        },
        include: {
          client: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, type: true } },
          company: { select: { id: true, name: true } },
        },
      });

      let transaction = null;
      if (initialAmount > 0) {
        transaction = await tx.transaction.create({
          data: {
            billId: bill.id,
            clientId: client.id,
            amountCollected: initialAmount,
            mode: initialMode,
            operatorId: userId,
            createdById: userId,
            // Same timestamp as the bill — the initial payment happened
            // "on the bill's date" by definition, even if the bill is
            // backdated.
            createdAt: billTimestamp,
          },
        });
      }

      return { bill, transaction };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not create bill." });
  }
});

module.exports = router;
