const express = require("express");
const argon2 = require("argon2");
const prisma = require("../config/prisma");
const { requireAuth } = require("../middleware/auth");
const { validatePassword } = require("../utils/passwordPolicy");

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

// PATCH /api/auth/password — any logged-in user changes their OWN password.
// Body: { currentPassword, newPassword }
//
// Always acts on req.session.user.id — never a body-supplied user id —
// so there's no way for this endpoint to be used to change someone
// else's password. That's what the developer-only user-management routes
// in users.js are for (a developer resetting another account entirely,
// which doesn't need the current password).
router.patch("/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required." });
  }

  const policyError = validatePassword(newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
  if (!user || user.isDeleted) {
    // Shouldn't normally happen (session implies an existing, active
    // account), but handle gracefully rather than crashing if an admin
    // deactivated this exact user moments ago in another tab.
    return res.status(401).json({ error: "Your account could not be found. Please log in again." });
  }

  const currentMatches = await argon2.verify(user.passwordHash, currentPassword);
  if (!currentMatches) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const newPasswordHash = await argon2.hash(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newPasswordHash },
  });

  // Force re-login with the new password: destroy the current session
  // rather than letting them keep working under the old one. Password
  // changes are exactly the kind of security-sensitive event where the
  // old session shouldn't just keep coasting along.
  req.session.destroy((err) => {
    if (err) {
      // The password itself was already changed successfully — a
      // failure to destroy the session cleanly isn't worth reporting as
      // an error to the user, so still respond with success. The cookie
      // clear below and the frontend's own redirect-to-login handle the
      // rest regardless.
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true, forceRelogin: true });
  });
});

module.exports = router;
