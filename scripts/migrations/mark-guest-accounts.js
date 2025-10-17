#!/usr/bin/env node

/*
 * Normalizes guest accounts created before the `isGuest` field existed by
 * clearing legacy placeholder emails and ensuring the new boolean flag is set.
 *
 * Usage:
 *   node scripts/migrations/mark-guest-accounts.js
 *
 * The script respects the same environment variables as the application for
 * selecting a MongoDB URI:
 *   - MONGODB_ATLAS_CONNECTION_STRING
 *   - MONGODB_URI
 * and falls back to mongodb://localhost:27017/cloaks-gambit for local runs.
 */

const path = require('path');
const mongoose = require('mongoose');

try {
  // Attempt to load environment variables if a .env file is present.
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
} catch (err) {
  // Optional dependency; ignore if not installed or file missing.
}

const User = require('../../src/models/User');

const LEGACY_GUEST_EMAIL_REGEX = /@guest\.local$/i;

function resolveMongoUri() {
  const atlas = process.env.MONGODB_ATLAS_CONNECTION_STRING;
  if (atlas) {
    return atlas;
  }
  return process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit';
}

async function run() {
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error('No MongoDB connection string found in environment');
  }

  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const cursor = User.find({
    $or: [
      { email: { $regex: LEGACY_GUEST_EMAIL_REGEX } },
      { isGuest: { $ne: true }, email: { $exists: false } },
    ],
  }).cursor();

  let processed = 0;
  let updated = 0;
  let attemptCounter = (await User.countDocuments()) + 1;

  // eslint-disable-next-line no-restricted-syntax
  for await (const user of cursor) {
    processed += 1;
    let changed = false;

    if (user.email && LEGACY_GUEST_EMAIL_REGEX.test(user.email)) {
      user.email = undefined;
      changed = true;
    }

    if (user.isGuest !== true) {
      user.isGuest = true;
      changed = true;
    }

    if (!user.username || typeof user.username !== 'string') {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        user.username = `Anonymous${attemptCounter}`;
        attemptCounter += 1;
        try {
          await user.save();
          updated += 1;
          changed = false;
          break;
        } catch (err) {
          if (err?.code === 11000 && err?.keyPattern?.username) {
            // Username collision, try the next suffix.
            continue;
          }
          throw err;
        }
      }
      continue;
    }

    if (changed) {
      await user.save();
      updated += 1;
    }
  }

  await mongoose.disconnect();

  console.log('Guest normalization complete', { processed, updated });
}

run().catch((err) => {
  console.error('Failed to normalize guest accounts:', err);
  process.exitCode = 1;
});

