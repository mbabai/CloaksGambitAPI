const mongoose = require('mongoose');
const User = require('../models/User');

const LEGACY_GUEST_EMAIL_REGEX = /@guest\.local$/i;

async function normalizeLegacyGuest(user) {
  if (!user) return user;

  let changed = false;

  if (user.email && LEGACY_GUEST_EMAIL_REGEX.test(user.email)) {
    user.email = undefined;
    changed = true;
  }

  if (user.isGuest !== true && (changed || !user.email)) {
    user.isGuest = true;
    changed = true;
  }

  if (changed) {
    await user.save();
  }

  return user;
}

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
          const normalized = await normalizeLegacyGuest(existing);
          return {
            userId: normalized._id.toString(),
            username: normalized.username,
            isGuest: Boolean(normalized.isGuest),
          };
        }

        let attempt = await User.countDocuments() + 1;
        while (true) {
          existing.username = `Anonymous${attempt}`;
          existing.isGuest = true;
          existing.email = undefined;
          try {
            const saved = await existing.save();
            return {
              userId: saved._id.toString(),
              username: saved.username,
              isGuest: Boolean(saved.isGuest),
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

    let attempt = await User.countDocuments() + 1;
    while (true) {
      const username = `Anonymous${attempt}`;
      const data = { username, isGuest: true };
      if (id && mongoose.isValidObjectId(id)) {
        data._id = id;
      }
      try {
        const user = await User.create(data);
        return {
          userId: user._id.toString(),
          username: user.username,
          isGuest: Boolean(user.isGuest),
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
