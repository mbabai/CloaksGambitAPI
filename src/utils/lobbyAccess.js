const { applyGuestCookies, resolveSessionFromRequest } = require('./requestSession');

async function resolveLobbySession(req, res) {
  const session = await resolveSessionFromRequest(req, { createGuest: true });
  if (!session?.userId) {
    if (res && typeof res.status === 'function') {
      res.status(401).json({ message: 'Unable to resolve session' });
    }
    return null;
  }

  if (session.isGuest) {
    applyGuestCookies(req, res, session);
  }

  return session;
}

module.exports = {
  resolveLobbySession,
};
