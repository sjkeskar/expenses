// Defensive best practice, NOT load-bearing for correctness anymore: all
// timestamp columns are `timestamptz` (see prisma/schema.prisma), which
// Postgres always stores as a true UTC instant internally regardless of
// what timezone the writing process considered "local" — so this pin is
// no longer required to avoid the double-offset bug that motivated it
// originally. Left in place anyway so nothing else in the app (logging,
// etc.) can silently depend on the Windows server PC's own OS timezone.
process.env.TZ = "UTC";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const sessionMiddleware = require("./config/session");

// Each is mounted at /api/<name> from src/routes/<name>.js.
const API_ROUTES = [
  "auth", "users", "settings", "locations", "patients", "doctors", "panels", "camps",
  "catalog", "machines", "approvals", "quotations", "bills", "transactions", "daysheet", "verify", "analytics",
];

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

// Content-Security-Policy — defence in depth behind React's escaping, so
// that a future raw-HTML slip is a bug rather than a working stored-XSS hole
// (see bugs/Closed/BUG-004). Applies to every response.
//
// - script-src 'self' is what neutralises an injected `onerror=` handler.
//   It holds because the built app (client/dist) has no inline script: Vite
//   emits one external module. Keep it that way.
// - style-src keeps 'unsafe-inline': antd injects its component styles as
//   <style> tags at runtime.
// - Everything else is 'self': fonts are the OS's own (antd's default font
//   stack), so nothing loads from the internet — the app only needs the LAN.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

app.use((req, res, next) => {
  res.set("Content-Security-Policy", CSP);
  next();
});

// Never let a browser cache an API response. Without this, pressing Back
// after signing out re-rendered a page from cache with a stale 200 from
// /api/auth/me still in it (see bugs/Closed/BUG-007). With no-store, the
// app's session check (client/src/auth/session.tsx) always gets a real
// answer, and a 401 sends the user to the login page.
//
// Must come above the route mounts so it applies to every /api/* response.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// API routes
for (const name of API_ROUTES) app.use(`/api/${name}`, require(`./routes/${name}`));

// The React app (client/, built into client/dist by `npm run build`). Its
// routes live in the browser, so any other GET without a file extension
// gets index.html. The pre-pivot pages' URLs redirect into the app, so
// bookmarks on the client PCs keep working.
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");
if (!fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
  console.warn("client/dist is missing — run `npm run build` to build the frontend. The API works without it.");
}
const LEGACY_PAGES = { "/login.html": "/login", "/operator.html": "/", "/admin.html": "/", "/accountant.html": "/", "/developer.html": "/" };

app.get(Object.keys(LEGACY_PAGES), (req, res) => res.redirect(301, LEGACY_PAGES[req.path]));
app.use(express.static(CLIENT_DIST, { index: false }));
app.get(/^\/(?!api\/)[^.]*$/, (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));

// Fallback 404 for unknown API routes
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
  console.log(`Laboratory Management System listening on http://0.0.0.0:${PORT}`);
});
