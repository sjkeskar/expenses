// requireAuth: blocks the request unless a session user is present.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in." });
  }
  next();
}

// requireRole(...roles): blocks the request unless the logged-in user's
// role is one of the allowed roles. Always call requireAuth first.
//
// This is the single source of truth for the permission matrix in
// Section 5 of the spec:
//   operator  -> bills/transactions only
//   admin     -> bills/transactions + analytics + promote operator->admin
//   developer -> user lifecycle only (create/promote/demote/deactivate)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: "Not logged in." });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Not permitted for this role." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
