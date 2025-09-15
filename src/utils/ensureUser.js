const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Ensure a user account exists for the given identifier.
 * If the provided ID is missing or does not correspond to an existing user,
 * a new guest account will be created using an incrementing AnonymousX scheme.
 * Returns the user's ID and username.
 *
 * @param {string|mongoose.Types.ObjectId|undefined} providedId
 * @returns {Promise<{ userId: string, username: string, isGuest: boolean }>} Resolved user info
 */
async function ensureUser(providedId) {
  let id = providedId;
  try {
    if (id && mongoose.isValidObjectId(id)) {
      const existing = await User.findById(id);
      if (existing) {
        if (existing.username) {
          return {
            userId: existing._id.toString(),
            username: existing.username,
            isGuest: (existing.email || '').endsWith('@guest.local')
          };
        }

        let attempt = await User.countDocuments() + 1;
        while (true) {
          const username = `Anonymous${attempt}`;
          existing.username = username;
          if (!existing.email) {
            const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
            existing.email = `${nonce}@guest.local`;
          }
          try {
            const saved = await existing.save();
            return {
              userId: saved._id.toString(),
              username: saved.username,
              isGuest: (saved.email || '').endsWith('@guest.local')
            };
          } catch (err) {
            if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
              attempt += 1;
              continue;
            }
            throw err;
          }
        }
      }
    }

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const email = `${nonce}@guest.local`;

    let attempt = await User.countDocuments() + 1;
    while (true) {
      const username = `Anonymous${attempt}`;
      const data = { username, email };
      if (id && mongoose.isValidObjectId(id)) {
        data._id = id;
      }
      try {
        const user = await User.create(data);
        return {
          userId: user._id.toString(),
          username: user.username,
          isGuest: (user.email || '').endsWith('@guest.local')
        };
      } catch (err) {
        if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    // Re-throw to allow callers to handle
    throw err;
  }
}

module.exports = ensureUser;
