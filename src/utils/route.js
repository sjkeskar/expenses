const prisma = require("../config/prisma");

// Express 4 does not catch a rejected promise from an async handler, so
// every route is wrapped in route(). A thrown { status, message, details? }
// becomes that JSON error (details are merged into the body); a Prisma
// unique violation becomes a 409 and "record to update not found" a 404;
// anything else is logged and becomes a 500 carrying `fallback`, so a bug
// never hangs a request.
function route(fallback, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err && err.status) return res.status(err.status).json({ error: err.message, ...err.details });
      if (err && err.code === "P2002") return res.status(409).json({ error: "That already exists." });
      if (err && err.code === "P2025") return res.status(404).json({ error: "Not found." });
      console.error(fallback, err);
      res.status(500).json({ error: fallback });
    }
  };
}

// Interactive transactions get 10s instead of Prisma's 5s default: the
// budget has to absorb row-lock waits as well as the work itself, since
// several technicians can queue on the same bill.
function transaction(fn) {
  return prisma.$transaction(fn, { timeout: 10_000 });
}

module.exports = { route, transaction };
