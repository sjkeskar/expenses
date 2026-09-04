const session = require("express-session");

// Confirmed decisions baked in here:
// - In-memory session store (express-session's default MemoryStore).
//   Trade-off accepted: all operators are logged out if the Node process
//   restarts. No extra store package needed.
// - Session length: 4 hours (SESSION_MAX_AGE_MS, default 14400000ms).
// - Cookie is NOT marked `secure` because the app is served over plain
//   HTTP on the LAN (no TLS). If TLS is ever added in front of this app,
//   set secure: true and set the "trust proxy" setting in server.js.
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: Number(process.env.SESSION_MAX_AGE_MS) || 4 * 60 * 60 * 1000,
  },
});

module.exports = sessionMiddleware;
