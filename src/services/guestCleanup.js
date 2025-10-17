const User = require('../models/User');

const ONE_HOUR_MS = 60 * 60 * 1000;
const DISCONNECT_RETENTION_MS = 24 * ONE_HOUR_MS;

let cleanupInterval = null;

async function removeStaleGuests() {
  const cutoff = new Date(Date.now() - DISCONNECT_RETENTION_MS);
  try {
    const result = await User.deleteMany({
      isGuest: true,
      lastDisconnectedAt: { $lte: cutoff }
    });

    if (result?.deletedCount) {
      console.log('[guestCleanup] Removed stale anonymous accounts', {
        deletedCount: result.deletedCount,
        cutoff
      });
    }
  } catch (err) {
    console.error('[guestCleanup] Failed to remove stale anonymous accounts:', err);
  }
}

function startGuestCleanupTask() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  removeStaleGuests().catch((err) => {
    console.error('[guestCleanup] Initial cleanup run failed:', err);
  });

  cleanupInterval = setInterval(() => {
    removeStaleGuests().catch((err) => {
      console.error('[guestCleanup] Scheduled cleanup run failed:', err);
    });
  }, ONE_HOUR_MS);

  return cleanupInterval;
}

function stopGuestCleanupTask() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

module.exports = {
  startGuestCleanupTask,
  stopGuestCleanupTask,
};

