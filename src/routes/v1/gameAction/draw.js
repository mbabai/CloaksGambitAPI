const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');
const eventBus = require('../../../eventBus');

const DRAW_COOLDOWN_MS = 10000;

function normalizeTime(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

router.post('/', async (req, res) => {
  try {
    const { gameId, color, action } = req.body || {};
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    const normalizedAction = typeof action === 'string' ? action.toLowerCase() : '';
    if (!['offer', 'accept', 'decline'].includes(normalizedAction)) {
      return res.status(400).json({ message: 'Invalid draw action' });
    }

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is already ended' });
    }

    if (!Array.isArray(game.drawOfferCooldowns) || game.drawOfferCooldowns.length !== 2) {
      game.drawOfferCooldowns = [null, null];
    }

    const config = new ServerConfig();
    const affectedUsers = (game.players || []).map((p) => p.toString());
    const now = Date.now();

    if (normalizedAction === 'offer') {
      if (game.drawOffer && game.drawOffer.player !== undefined && game.drawOffer.player !== null) {
        if (game.drawOffer.player === normalizedColor) {
          return res.status(400).json({ message: 'You already have a pending draw offer' });
        }
        return res.status(400).json({ message: 'Opponent already has a pending draw offer' });
      }
      const cooldownValue = game.drawOfferCooldowns[normalizedColor];
      const cooldownUntil = normalizeTime(cooldownValue);
      if (cooldownUntil && cooldownUntil > now) {
        const retryAfter = Math.ceil((cooldownUntil - now) / 1000);
        return res.status(429).json({ message: 'Draw offer recently declined. Please wait before offering again.', retryAfter });
      }

      game.drawOffer = { player: normalizedColor, createdAt: new Date(now) };
      game.markModified('drawOffer');
      await game.save();

      eventBus.emit('gameChanged', {
        game,
        affectedUsers
      });

      return res.json({ message: 'Draw offer sent' });
    }

    const offer = game.drawOffer;
    if (!offer || offer.player === undefined || offer.player === null) {
      return res.status(400).json({ message: 'No draw offer to respond to' });
    }

    if (normalizedAction === 'accept') {
      if (offer.player === normalizedColor) {
        return res.status(400).json({ message: 'Cannot accept your own draw offer' });
      }

      const updatedGame = await game.endGame(null, config.winReasons.get('DRAW'));

      eventBus.emit('gameChanged', {
        game: typeof updatedGame.toObject === 'function' ? updatedGame.toObject() : updatedGame,
        affectedUsers
      });

      return res.json({ message: 'Draw accepted' });
    }

    if (offer.player === normalizedColor) {
      return res.status(400).json({ message: 'Cannot decline your own draw offer' });
    }

    const offeringPlayer = offer.player;
    game.drawOffer = null;
    game.markModified('drawOffer');
    const cooldownUntil = new Date(now + DRAW_COOLDOWN_MS);
    game.drawOfferCooldowns[offeringPlayer] = cooldownUntil;
    game.markModified('drawOfferCooldowns');
    await game.save();

    eventBus.emit('gameChanged', {
      game,
      affectedUsers
    });

    return res.json({ message: 'Draw offer declined' });
  } catch (err) {
    console.error('Error handling draw action', err);
    return res.status(500).json({ message: err.message || 'Failed to process draw action' });
  }
});

module.exports = router;
