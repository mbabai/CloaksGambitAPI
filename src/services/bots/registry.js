const User = require('../../models/User');
const ensureUser = require('../../utils/ensureUser');
const { createAuthToken } = require('../../utils/authTokens');

const BOT_DEFINITIONS = {
  easy: {
    username: 'EasyBot',
    email: 'easy.bot@cg-bots.local',
    elo: 800,
  },
  medium: {
    username: 'MediumBot',
    email: 'medium.bot@cg-bots.local',
    elo: 1200,
  },
  hard: {
    username: 'HardBot',
    email: 'hard.bot@cg-bots.local',
    elo: 1600,
  },
};

function normalizeDifficulty(input) {
  if (!input || typeof input !== 'string') return 'easy';
  const key = input.trim().toLowerCase();
  if (key === 'easy' || key === 'medium' || key === 'hard') return key;
  return 'easy';
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

async function ensureGuestForBotGame(userId) {
  if (!userId) return ensureUser();
  return ensureUser(userId);
}

module.exports = {
  ensureBotUser,
  ensureGuestForBotGame,
  normalizeDifficulty,
  BOT_DEFINITIONS,
};
