// Defensive best practice, NOT load-bearing for correctness anymore: all
// timestamp columns are `timestamptz` (see prisma/schema.prisma), which
// Postgres always stores as a true UTC instant internally regardless of
// what timezone the writing process considered "local" — so this pin is
// no longer required to avoid the double-offset bug that motivated it
// originally. Left in place anyway so nothing else in the app (logging,
// etc.) can silently depend on the Windows server PC's own OS timezone.
process.env.TZ = "UTC";

require("dotenv").config();
const path = require("path");
const express = require("express");
const sessionMiddleware = require("./config/session");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const clientRoutes = require("./routes/clients");
const billRoutes = require("./routes/bills");
const transactionRoutes = require("./routes/transactions");
const analyticsRoutes = require("./routes/analytics");
const locationRoutes = require("./routes/locations");
const categoryRoutes = require("./routes/categories");
const companyRoutes = require("./routes/companies");

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// Safety net: every route handler in this app is expected to catch its own
// errors and respond with a proper JSON error (see e.g. transactions.js).
// This is a backstop for the case where a future bug misses that pattern —
// an uncaught error in one request should never take the whole server (and
// every other operator's connection) down with it. Without this, Node's
// default behavior since v15 is to terminate the entire process on an
// unhandled promise rejection, which is exactly what happened when the
// "payment exceeds balance" check wasn't properly caught (now fixed).
process.on("unhandledRejection", (reason) => {
  console.error(
    "Unhandled promise rejection — this indicates a bug in a route handler " +
      "(a request likely never got a response). The server is staying up:",
    reason
  );
});

process.on("uncaughtException", (err) => {
  console.error(
    "Uncaught exception — this indicates a serious bug. The server is staying up, " +
      "but please report this so it can be fixed properly:",
    err
  );
});

const app = express();

app.use(express.json());
app.use(sessionMiddleware);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/companies", companyRoutes);

// Root path has no index.html of its own — redirect straight to the
// login page instead of a blank 404, so people don't need to know/type
// the exact filename to get started.
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

// Static frontend (plain HTML/CSS/JS, separate page per role — confirmed decision)
app.use(express.static(path.join(__dirname, "..", "public")));

// Fallback 404 for unknown API routes (keep after static so real files still resolve)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Final error handler — catches anything passed to next(err), or a
// synchronous throw in a route that isn't already wrapped in try/catch.
// Must be the last app.use(). Individual routes should still catch and
// respond to their own errors (see try/catch blocks in src/routes/) —
// this is only a backstop so a miss there returns a proper error
// response instead of hanging the request or crashing the server.
app.use((err, req, res, next) => {
  console.error("Unhandled route error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Payment Tracking System listening on http://0.0.0.0:${PORT}`);
});
