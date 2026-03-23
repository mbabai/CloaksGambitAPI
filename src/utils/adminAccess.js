const { resolveSessionFromRequest, resolveSessionFromSocketHandshake } = require('./requestSession');

const ADMIN_EMAIL = 'marcellbabai@gmail.com';
const ADMIN_FORBIDDEN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Access Required</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #111827;
      color: #f9fafb;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    main {
      max-width: 480px;
      background: rgba(17, 24, 39, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.6rem;
      line-height: 1.2;
    }
    p {
      margin: 0 0 12px;
      color: #d1d5db;
    }
    a {
      color: #93c5fd;
    }
  </style>
</head>
<body>
  <main>
    <h1>Admin Access Required</h1>
    <p>This page requires an authenticated admin session.</p>
    <p>If you expected access, sign in with the admin account and try again.</p>
    <p><a href="/">Return to the main page</a></p>
  </main>
</body>
</html>`;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function wantsHtmlResponse(req) {
  const accept = String(req?.headers?.accept || '').toLowerCase();
  const secFetchDest = String(req?.headers?.['sec-fetch-dest'] || '').toLowerCase();
  return secFetchDest === 'document' || accept.includes('text/html');
}

function isAdminSession(session) {
  if (!session?.authenticated || session?.isGuest) {
    return false;
  }
  return normalizeEmail(session.email || session.user?.email) === ADMIN_EMAIL;
}

async function ensureAdminRequest(req, res) {
  const session = await resolveSessionFromRequest(req, { createGuest: false });
  if (isAdminSession(session)) {
    return session;
  }

  if (res && typeof res.status === 'function') {
    if (wantsHtmlResponse(req) && typeof res.type === 'function' && typeof res.send === 'function') {
      res.status(403);
      res.type('html');
      res.send(ADMIN_FORBIDDEN_HTML);
    } else {
      res.status(403).json({ message: 'Forbidden' });
    }
  }
  return null;
}

async function ensureAdminSocketHandshake(handshake) {
  const session = await resolveSessionFromSocketHandshake(handshake, { createGuest: false });
  return isAdminSession(session) ? session : null;
}

module.exports = {
  ADMIN_EMAIL,
  ensureAdminRequest,
  ensureAdminSocketHandshake,
  isAdminSession,
};
