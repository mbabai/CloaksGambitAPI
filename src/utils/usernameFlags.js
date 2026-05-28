const User = require('../models/User');

async function backfillMissingUsernameUpdatedFlags() {
  const result = await User.updateMany(
    { hasUpdatedUsername: { $exists: false } },
    { $set: { hasUpdatedUsername: false } }
  );

  return {
    matchedCount: Number(result?.matchedCount ?? result?.n ?? 0),
    modifiedCount: Number(result?.modifiedCount ?? result?.nModified ?? 0),
  };
}

module.exports = {
  backfillMissingUsernameUpdatedFlags,
};
