const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const Match = require('../../../models/Match');
const eventBus = require('../../../eventBus');

const AUTO_NEXT_COUNTDOWN_SECONDS = 5;

function toStringId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

async function buildNextResponse(gameDoc, color, {
  message = 'Player marked next',
  alreadyNext = false,
  countdownStarted = false,
  countdownSeconds = AUTO_NEXT_COUNTDOWN_SECONDS,
} = {}) {
  if (!gameDoc) {
    return {
      response: {
        message: 'Game not found',
        gameId: null,
        matchId: null,
        color,
        playersNext: [false, false],
        bothNext: false,
        alreadyNext: false,
        countdownStarted: false,
        countdownSeconds: null,
      },
      match: null,
      nextGame: null,
    };
  }

  const playersNextRaw = Array.isArray(gameDoc.playersNext) ? gameDoc.playersNext : [];
  const playersNext = [Boolean(playersNextRaw[0]), Boolean(playersNextRaw[1])];
  const bothNext = Boolean(playersNext[0] && playersNext[1]);

  const gameId = toStringId(gameDoc._id) || toStringId(gameDoc.id);
  const matchId = toStringId(gameDoc.match);

  let match = null;
  let nextGame = null;

  if (bothNext && matchId) {
    try {
      match = await Match.findById(matchId).populate('games').lean();
      if (Array.isArray(match?.games)) {
        nextGame = match.games.find((g) => g && g.isActive) || null;
      }
    } catch (err) {
      console.error('Error loading match for next response:', err);
    }
  }

  const response = {
    message,
    color,
    gameId,
    matchId,
    playersNext,
    bothNext,
    alreadyNext: Boolean(alreadyNext),
    countdownStarted: Boolean(countdownStarted),
    countdownSeconds: countdownStarted
      ? (Number.isFinite(countdownSeconds) ? countdownSeconds : AUTO_NEXT_COUNTDOWN_SECONDS)
      : null,
  };

  if (bothNext && match && !nextGame) {
    response.matchEnded = true;
    response.matchIsActive = Boolean(match.isActive);
  }

  if (nextGame) {
    response.nextGameId = toStringId(nextGame._id) || toStringId(nextGame.id);
    response.nextGameIsActive = Boolean(nextGame.isActive);
    response.nextGamePlayers = Array.isArray(nextGame.players)
      ? nextGame.players.map(toStringId).filter(Boolean)
      : [];
  }

  return { response, match, nextGame };
}

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    const game = await Game.findById(gameId).lean();
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // If this player is already marked next, acknowledge without re-emitting events
    if (game.playersNext?.[normalizedColor]) {
      const { response } = await buildNextResponse(game, normalizedColor, {
        message: 'Player already marked next',
        alreadyNext: true,
      });
      return res.json(response);
    }

    const updated = await Game.findByIdAndUpdate(
      gameId,
      { $set: { [`playersNext.${normalizedColor}`]: true } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const other = 1 - normalizedColor;
    let countdownStarted = false;

    if (!updated.playersNext?.[other]) {
      const otherUser = updated.players?.[other]?.toString();
      if (otherUser) {
        eventBus.emit('nextCountdown', {
          gameId: updated._id.toString(),
          color: other,
          seconds: AUTO_NEXT_COUNTDOWN_SECONDS,
          affectedUsers: [otherUser]
        });
      }

      countdownStarted = true;

      setTimeout(async () => {
        try {
          const check = await Game.findById(gameId).lean();
          if (check && !check.playersNext?.[other]) {
            const auto = await Game.findByIdAndUpdate(
              gameId,
              { $set: { [`playersNext.${other}`]: true } },
              { new: true }
            ).lean();
            if (auto && auto.players?.length === 2) {
              eventBus.emit('players:bothNext', {
                game: auto,
                affectedUsers: auto.players.map(p => p.toString())
              });
            }
          }
        } catch (err) {
          console.error('Auto-next error:', err);
        }
      }, AUTO_NEXT_COUNTDOWN_SECONDS * 1000);
    }

    const { response, nextGame } = await buildNextResponse(updated, normalizedColor, {
      countdownStarted,
      countdownSeconds: AUTO_NEXT_COUNTDOWN_SECONDS,
    });

    if (response.bothNext) {
      const eventGame = nextGame || updated;
      const affected = Array.isArray(nextGame?.players)
        ? nextGame.players.map(toStringId).filter(Boolean)
        : (updated.players || []).map(toStringId).filter(Boolean);

      eventBus.emit('players:bothNext', {
        game: eventGame,
        affectedUsers: affected,
      });
    }

    res.json(response);
  } catch (err) {
    console.error('Error in next endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
