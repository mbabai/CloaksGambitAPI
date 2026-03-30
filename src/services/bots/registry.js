const crypto = require('crypto');
const User = require('../../models/User');
const ensureUser = require('../../utils/ensureUser');
const { createAuthToken } = require('../../utils/authTokens');

const BOT_DEFINITIONS = {
  easy: {
    id: 'easy',
    label: 'Easy',
    username: 'EasyBot',
    email: 'easy.bot@cg-bots.local',
    elo: 800,
    playable: true,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    username: 'MediumBot',
    email: 'medium.bot@cg-bots.local',
    elo: 1200,
    playable: true,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    username: 'HardBot',
    email: 'hard.bot@cg-bots.local',
    elo: 1600,
    playable: false,
    unavailableMessage: 'Hard bot still under construction.',
  },
};

const BUILTIN_BOT_ORDER = ['easy', 'medium', 'hard'];

function normalizeDifficulty(input) {
  if (!input || typeof input !== 'string') return 'easy';
  const key = input.trim().toLowerCase();
  if (key === 'easy' || key === 'medium' || key === 'hard') return key;
  return 'easy';
}

function normalizeBuiltinBotId(input) {
  if (!input || typeof input !== 'string') return '';
  const key = input.trim().toLowerCase();
  return BOT_DEFINITIONS[key] ? key : '';
}

function isBuiltinBotId(input) {
  return Boolean(normalizeBuiltinBotId(input));
}

function getBuiltinBotDefinition(input) {
  const key = normalizeBuiltinBotId(input);
  return key ? BOT_DEFINITIONS[key] : null;
}

function listBuiltinBotCatalog() {
  return BUILTIN_BOT_ORDER
    .map((id) => BOT_DEFINITIONS[id])
    .filter(Boolean)
    .map((definition, index) => ({
      id: definition.id,
      type: 'builtin',
      label: definition.label,
      playable: definition.playable !== false,
      order: index,
      unavailableMessage: definition.unavailableMessage || null,
    }));
}

function normalizeInstanceKey(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildBotInstanceUsername(difficulty, instanceKey) {
  const base = `${normalizeDifficulty(difficulty)}bot`;
  const suffix = (normalizeInstanceKey(instanceKey) || crypto.randomBytes(4).toString('hex')).slice(-8);
  return `${base}_${suffix}`.slice(0, 18);
}

function buildBotInstanceEmail(difficulty, instanceKey) {
  const suffix = normalizeInstanceKey(instanceKey) || crypto.randomBytes(8).toString('hex');
  return `${normalizeDifficulty(difficulty)}.instance.${suffix}@cg-bots.local`;
}

async function ensureBotUser(difficulty = 'easy') {
  const key = normalizeDifficulty(difficulty);
  const def = BOT_DEFINITIONS[key];
  if (!def) {
    throw new Error(`Unsupported bot difficulty: ${difficulty}`);
  }

  let bot = await User.findOne({ email: def.email }).lean();
  if (bot) {
    return { user: bot, token: createAuthToken(bot) };
  }

  const existingByUsername = await User.findOne({ username: def.username }).lean();
  if (existingByUsername) {
    bot = existingByUsername;
    if (!bot.email || bot.isGuest) {
      await User.updateOne({ _id: bot._id }, {
        $set: {
          email: def.email,
          isBot: true,
          botDifficulty: key,
          isGuest: false,
        },
      });
      bot.email = def.email;
      bot.isBot = true;
      bot.botDifficulty = key;
      bot.isGuest = false;
    }
    return { user: bot, token: createAuthToken(bot) };
  }

  const payload = {
    username: def.username,
    email: def.email,
    elo: def.elo,
    isBot: true,
    botDifficulty: key,
    isGuest: false,
  };

  const created = await User.create(payload);
  const lean = created.toObject();
  return { user: lean, token: createAuthToken(created) };
}

async function ensureBotUserInstance({ difficulty = 'easy', instanceKey = '' } = {}) {
  const key = normalizeDifficulty(difficulty);
  const def = BOT_DEFINITIONS[key];
  if (!def) {
    throw new Error(`Unsupported bot difficulty: ${difficulty}`);
  }

  const normalizedInstanceKey = normalizeInstanceKey(instanceKey) || crypto.randomBytes(8).toString('hex');
  const email = buildBotInstanceEmail(key, normalizedInstanceKey);

  let bot = await User.findOne({ email }).lean();
  if (bot) {
    return { user: bot, token: createAuthToken(bot) };
  }

  const payload = {
    username: buildBotInstanceUsername(key, normalizedInstanceKey),
    email,
    elo: def.elo,
    isBot: true,
    botDifficulty: key,
    isGuest: false,
  };

  try {
    const created = await User.create(payload);
    const lean = created.toObject();
    return { user: lean, token: createAuthToken(created) };
  } catch (err) {
    if (err?.code === 11000) {
      bot = await User.findOne({ email }).lean();
      if (bot) {
        return { user: bot, token: createAuthToken(bot) };
      }
    }
    throw err;
  }
}

async function ensureGuestForBotGame(userId) {
  if (!userId) return ensureUser();
  return ensureUser(userId);
}

module.exports = {
  ensureBotUser,
  ensureBotUserInstance,
  ensureGuestForBotGame,
  normalizeDifficulty,
  normalizeBuiltinBotId,
  isBuiltinBotId,
  getBuiltinBotDefinition,
  listBuiltinBotCatalog,
  BUILTIN_BOT_ORDER,
  BOT_DEFINITIONS,
  normalizeInstanceKey,
};
