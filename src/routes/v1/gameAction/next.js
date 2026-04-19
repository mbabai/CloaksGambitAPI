const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const Match = require('../../../models/Match');
const eventBus = require('../../../eventBus');
const { requireGamePlayerContext } = require('../../../utils/gameAccess');

function resolveAcceptState(match, game) {
  if (typeof game?.requiresAccept === 'boolean') {
    const requiresAccept = Boolean(game.requiresAccept);
    const acceptWindowSeconds = Number.isFinite(Number(game?.acceptWindowSeconds))
      ? Math.max(0, Number(game.acceptWindowSeconds))
      : (requiresAccept ? 30 : 0);
    return { requiresAccept, acceptWindowSeconds };
  }
  const matchType = String(match?.type || '').toUpperCase();
  const player1Score = Number(match?.player1Score || 0);
  const player2Score = Number(match?.player2Score || 0);
  const drawCount = Number(match?.drawCount || 0);
  const requiresAccept = matchType === 'TOURNAMENT_ROUND_ROBIN'
    || (matchType === 'TOURNAMENT_ELIMINATION' && (player1Score + player2Score + drawCount) === 0);
  return {
    requiresAccept,
    acceptWindowSeconds: requiresAccept ? 30 : 0,
  };
}

function normalizeGameId(gameLike) {
  if (!gameLike) return '';
  if (typeof gameLike === 'string' || typeof gameLike === 'number') {
    return String(gameLike);
  }
  if (typeof gameLike === 'object') {
    const rawId = gameLike._id ?? gameLike.id ?? null;
    if (rawId === null || rawId === undefined) return '';
    return typeof rawId.toString === 'function' ? rawId.toString() : String(rawId);
  }
  return '';
}

function resolveCurrentGameNumber(match, gameLike) {
  const games = Array.isArray(match?.games) ? match.games : [];
  if (games.length === 0) return 1;
  const targetId = normalizeGameId(gameLike);
  if (!targetId) {
    return games.length;
  }
  const targetIndex = games.findIndex((entry) => normalizeGameId(entry) === targetId);
  return targetIndex >= 0 ? targetIndex + 1 : games.length;
}

function getTournamentNextPayload(match, nextGame) {
  if (!nextGame) {
    return {
      hasNextGame: false,
      game: null,
      affectedUsers: [],
      currentGameNumber: Number.isFinite(Number(match?.games?.length)) ? Number(match.games.length) : 1,
      tournamentId: match?.tournamentId ? String(match.tournamentId) : null,
      tournamentPhase: match?.tournamentPhase || null,
      requiresAccept: false,
      acceptWindowSeconds: 0,
    };
  }
  const gameForEvent = typeof nextGame.toObject === 'function'
    ? nextGame.toObject()
    : nextGame;
  const affectedUsers = nextGame?.players?.length
    ? nextGame.players.map((player) => player.toString())
    : [];
  const { requiresAccept, acceptWindowSeconds } = resolveAcceptState(match, nextGame);
  return {
    hasNextGame: true,
    game: gameForEvent,
    affectedUsers,
    currentGameNumber: resolveCurrentGameNumber(match, nextGame),
    tournamentId: match?.tournamentId ? String(match.tournamentId) : null,
    tournamentPhase: match?.tournamentPhase || null,
    requiresAccept,
    acceptWindowSeconds,
  };
}

async function resolveNextGamePayload(matchId) {
  const match = await Match.findById(matchId).populate('games');
  if (!match) {
    return getTournamentNextPayload(null, null);
  }
  const nextGame = match?.games?.find((entry) => entry.isActive) || null;
  return getTournamentNextPayload(match, nextGame);
}

async function loadLatestMatch(matchId) {
  if (!matchId) return null;
  try {
    return await Match.findById(matchId).populate('games');
  } catch (_) {
    return null;
  }
}

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor } = context;

    // If this player is already marked next, acknowledge without re-emitting events
    if (game.playersNext?.[normalizedColor]) {
      return res.json({ message: 'Player already marked next' });
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

    if (!updated.playersNext?.[other]) {
      const otherUser = updated.players?.[other]?.toString();
      if (otherUser) {
        eventBus.emit('nextCountdown', {
          gameId: updated._id.toString(),
          color: other,
          seconds: 5,
          affectedUsers: [otherUser]
        });
      }

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
              const nextPayload = await resolveNextGamePayload(auto.match);
              if (nextPayload?.hasNextGame) {
                eventBus.emit('players:bothNext', nextPayload);
              }
            }
          }
        } catch (err) {
          console.error('Auto-next error:', err);
        }
      }, 5000);
    }

    if (updated.playersNext?.[0] && updated.playersNext?.[1]) {
      try {
        const nextPayload = await resolveNextGamePayload(updated.match);
        if (nextPayload?.hasNextGame) {
          eventBus.emit('players:bothNext', nextPayload);
        }
      } catch (err) {
        console.error('Error loading next game for players:bothNext:', err);
      }
    }

    const latestMatch = await loadLatestMatch(updated.match);
    const latestNextGame = latestMatch?.games?.find((entry) => entry.isActive) || null;
    res.json({
      message: 'Player marked next',
      hasNextGame: Boolean(latestNextGame),
      matchEnded: Boolean(latestMatch && (latestMatch.winner || latestMatch.endTime || latestMatch.isActive === false)),
    });
  } catch (err) {
    console.error('Error in next endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
