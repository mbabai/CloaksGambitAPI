const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, pieces, onDeck } = req.body;
    
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Validate color
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    // Check if setup is already complete for this color
    if (game.setupComplete[normalizedColor]) {
      return res.status(400).json({ message: 'Setup already completed for this color' });
    }

    const config = new ServerConfig();
    const expectedRank = normalizedColor === 0 ? 0 : config.boardDimensions.RANKS - 1;
    const expectedFiles = config.boardDimensions.FILES;

    // Validate pieces array
    if (!Array.isArray(pieces) || pieces.length !== expectedFiles) {
      return res.status(400).json({ 
        message: `Must provide exactly ${expectedFiles} pieces for setup` 
      });
    }

    // Validate onDeck
    if (!onDeck || !onDeck.identity) {
      return res.status(400).json({ message: 'Must provide a valid onDeck piece' });
    }

    // Check for king and validate piece positions
    let hasKing = false;
    const pieceCounts = new Map();
    
    for (const piece of pieces) {
      if (!piece || !piece.identity || piece.color !== normalizedColor) {
        return res.status(400).json({ message: 'Invalid piece data' });
      }

      // Count pieces for stash validation
      const identityKey = piece.identity;
      pieceCounts.set(identityKey, (pieceCounts.get(identityKey) || 0) + 1);

      // Check for king
      if (piece.identity === config.identities.get('KING')) {
        hasKing = true;
      }

      // Validate position
      if (piece.row !== expectedRank) {
        return res.status(400).json({ 
          message: `All pieces must be placed on rank ${expectedRank}` 
        });
      }
    }

    // Validate onDeck piece count
    const onDeckIdentity = onDeck.identity;
    pieceCounts.set(onDeckIdentity, (pieceCounts.get(onDeckIdentity) || 0) + 1);

    // Check if we have a king
    if (!hasKing) {
      return res.status(400).json({ message: 'Setup must include a KING piece' });
    }

    // Validate against stash
    const stash = game.stashes[normalizedColor];
    const stashCounts = new Map();
    
    for (const piece of stash) {
      const identityKey = piece.identity;
      stashCounts.set(identityKey, (stashCounts.get(identityKey) || 0) + 1);
    }

    // Check if we're using more pieces than available
    for (const [identity, count] of pieceCounts) {
      const stashCount = stashCounts.get(identity) || 0;
      if (count > stashCount) {
        return res.status(400).json({ 
          message: `Not enough pieces of type ${identity} in stash` 
        });
      }
    }

    // Remove used pieces from stash
    const newStash = [...stash];
    for (const piece of pieces) {
      const index = newStash.findIndex(p => 
        p.identity === piece.identity && p.color === piece.color
      );
      if (index !== -1) {
        newStash.splice(index, 1);
      }
    }

    // Remove onDeck piece from stash
    const onDeckIndex = newStash.findIndex(p => 
      p.identity === onDeck.identity && p.color === onDeck.color
    );
    if (onDeckIndex !== -1) {
      newStash.splice(onDeckIndex, 1);
    }

    // Update game state
    game.stashes[normalizedColor] = newStash;
    game.setupComplete[normalizedColor] = true;
    game.onDecks[normalizedColor] = onDeck;

    // Place pieces on board
    for (const piece of pieces) {
      game.board[piece.row][piece.col] = piece;
    }

    // Add setup action
    await game.addAction(
      config.actions.get('SETUP'),
      normalizedColor,
      {
        pieces: pieces.map(p => ({ 
          identity: p.identity,
          row: p.row,
          col: p.col 
        })),
        onDeck: {
          identity: onDeck.identity
        }
      }
    );

    await game.save();
    res.json({ message: 'Setup completed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 