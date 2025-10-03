function ensureAdminSecret(req, res) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.header('x-admin-secret') === adminSecret) {
    return true;
  }

  if (res && typeof res.status === 'function') {
    res.status(403).json({ message: 'Forbidden' });
  }
  return false;
}

module.exports = ensureAdminSecret;
