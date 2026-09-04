const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const VALID_TYPES = ["standard", "credit"];

// GET /api/categories — operator + admin. Active categories only, for the
// typeable category picker on the Create Bill form. Includes "type" and
// the linked "company" (for credit categories) so the frontend can show
// which company a credit category maps to without a separate field.
router.get("/", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      type: true,
      createdAt: true,
      company: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ categories });
});

// POST /api/categories — admin only.
// Body: { name, type, companyId?, companyName? }
//
// If type is "credit", a company is required — either companyId (an
// existing company, picked from the combobox) or companyName (free text,
// find-or-create by name — same pattern as client creation). This is the
// ONLY way a company ever gets created; there's no standalone "add
// company" screen.
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, type, companyId, companyName } = req.body;
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    return res.status(400).json({ error: "Category name is required." });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
  }
  if (type === "credit" && !companyId && !(companyName || "").trim()) {
    return res.status(400).json({ error: "A credit category requires a company name." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let resolvedCompanyId = null;

      if (type === "credit") {
        if (companyId) {
          const company = await tx.company.findUnique({ where: { id: companyId } });
          if (!company || !company.isActive) {
            throw { status: 400, message: "Select a valid company from the list." };
          }
          resolvedCompanyId = company.id;
        } else {
          const trimmedCompanyName = companyName.trim();
          let company = await tx.company.findFirst({
            where: { name: { equals: trimmedCompanyName, mode: "insensitive" } },
          });
          if (!company) {
            company = await tx.company.create({ data: { name: trimmedCompanyName } });
          } else if (!company.isActive) {
            company = await tx.company.update({ where: { id: company.id }, data: { isActive: true } });
          }
          resolvedCompanyId = company.id;
        }
      }

      const existing = await tx.category.findFirst({
        where: { name: { equals: trimmedName, mode: "insensitive" } },
      });
      if (existing) {
        if (existing.isActive) {
          throw { status: 409, message: "A category with that name already exists." };
        }
        // Reviving a previously-deleted category — apply whatever
        // type/company was submitted now, overwriting the old linkage.
        return tx.category.update({
          where: { id: existing.id },
          data: { isActive: true, type, companyId: resolvedCompanyId },
          select: {
            id: true,
            name: true,
            type: true,
            company: { select: { id: true, name: true } },
          },
        });
      }

      return tx.category.create({
        data: { name: trimmedName, type, companyId: resolvedCompanyId },
        select: {
          id: true,
          name: true,
          type: true,
          company: { select: { id: true, name: true } },
        },
      });
    });

    res.status(201).json({ category: result });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Could not create category." });
  }
});

// DELETE /api/categories/:id — admin only. Soft delete (isActive = false) —
// bills already using this category keep it for historical display; it
// just disappears from the picker for new bills. The linked company (if
// any) is NOT deactivated — it may still have outstanding bills that need
// settling even after this category is retired.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category || !category.isActive) {
    return res.status(404).json({ error: "Category not found." });
  }

  const updated = await prisma.category.update({
    where: { id: category.id },
    data: { isActive: false },
    select: { id: true, name: true, isActive: true },
  });
  res.json({ category: updated });
});

module.exports = router;
