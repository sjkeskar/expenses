const express = require("express");
const argon2 = require("argon2");
const prisma = require("../config/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/login
// Body: { name, password }
// "name" is the login identifier (confirmed decision — no separate username field).
router.post("/login", async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: "name and password are required." });
  }

  const user = await prisma.user.findUnique({ where: { name } });

  // Reject deleted/deactivated users the same way as "not found" —
  // don't leak which accounts exist.
  if (!user || user.isDeleted) {
    return res.status(401).json({ error: "Invalid name or password." });
  }

  const passwordMatches = await argon2.verify(user.passwordHash, password);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid name or password." });
  }

  // Store only what's needed in the session.
  req.session.user = {
    id: user.id,
    name: user.name,
    role: user.role,
  };

  res.json({
    user: { id: user.id, name: user.name, role: user.role },
    // Session is valid for 4 hours (see .env SESSION_MAX_AGE_MS).
    // Frontend shows a reminder to log out when stepping away, per
    // confirmed decision.
    sessionReminder:
      "Your session stays active for 4 hours. Please log out if you step away from this PC.",
  });
});

// POST /api/auth/logout
router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out cleanly." });
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// GET /api/auth/me — used by each role page on load to confirm session + role.
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

module.exports = router;
