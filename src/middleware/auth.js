const prisma = require("../config/prisma");

// requireAuth: blocks the request unless a session user is present AND
// that user still exists, is still active, and still has the role the
// session was issued with.
//
// The session is a 4-hour in-memory snapshot taken at login (see
// config/session.js). Trusting that snapshot meant a deactivated user
// kept working until it expired, and a demoted admin kept their admin
// rights for the rest of it — the developer page's deactivate/demote
// buttons appeared to do nothing until the person next logged in (see
// bugs/Closed/BUG-003).
//
// So re-read the user on every request. It is a primary-key lookup
// selecting four columns, which is cheap next to the queries the route
// handlers themselves run. If it ever does show up in a profile, the
// drop-in replacement is a per-user session-version counter bumped by
// promote/demote/deactivate, checked here instead of a full re-read.
//
// Note the try/catch: Express 4 does not catch a rejected promise from an
// async middleware, so without it a transient DB error would hang the
// request instead of reaching the backstop error handler in server.js.
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.user.id },
      select: { id: true, name: true, role: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
      return req.session.destroy(() =>
        res.status(401).json({ error: "Your session is no longer valid. Please log in again." })
      );
    }

    // Refresh the snapshot so requireRole below (and /auth/me, and every
    // handler reading req.session.user) sees the account as it is now,
    // not as it was at login.
    req.session.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

// requireRole(...roles): blocks the request unless the logged-in user's
// role is one of the allowed roles. Always call requireAuth first — it
// reads req.session.user.role, which requireAuth has just refreshed from
// the database, so a demotion takes effect on the very next request.
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
