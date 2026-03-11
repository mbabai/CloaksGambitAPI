const { resolveSessionFromRequest, resolveSessionFromSocketHandshake } = require('./requestSession');

const ADMIN_EMAIL = 'marcellbabai@gmail.com';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
    res.status(403).json({ message: 'Forbidden' });
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
