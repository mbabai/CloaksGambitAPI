const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const DEBUG_GAME_ACTIONS = process.env.DEBUG_GAME_ACTIONS === 'true';
const debugLog = (...args) => { if (DEBUG_GAME_ACTIONS) console.log(...args); };
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const {
  ensureStoredClockState,
  transitionStoredClockState,
  summarizeClockState,
} = require('../../../utils/gameClock');
const { appendLocalDebugLog } = require('../../../utils/localDebugLogger');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, pieces, onDeck } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor, requesterDetails } = context;
    debugLog('[gameAction:setup] incoming request', {
      gameId,
      color: normalizedColor,
      ...requesterDetails,
    });

    // Check if setup is already complete for this color
    if (game.setupComplete[normalizedColor]) {
      return res.status(400).json({ message: 'Setup already completed for this color' });
    }

    const config = await getServerConfig();
    const now = Date.now();
    ensureStoredClockState(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'setup',
      gameId,
      color: normalizedColor,
      playerTurn: game.playerTurn,
      setupComplete: game.setupComplete,
      clockState: summarizeClockState(game.clockState),
    });
    const expectedRank = normalizedColor === 0 ? 0 : config.boardDimensions.RANKS - 1;
    const expectedFiles = config.boardDimensions.FILES;

    // Validate pieces array
    if (!Array.isArray(pieces) || pieces.length !== expectedFiles) {
      return res.status(400).json({ 
        message: `Must provide exactly ${expectedFiles} pieces for setup` 
      });
    }

    // Validate onDeck
    if (!onDeck || !onDeck.identity || onDeck.color !== normalizedColor) {
      return res.status(400).json({ message: 'Must provide a valid onDeck piece' });
    }

    // Check for king and validate piece positions
    let hasKing = false;
    const pieceCounts = new Map();
    const usedColumns = new Set();

    for (const piece of pieces) {
      if (!piece || !piece.identity || piece.color !== normalizedColor) {
        return res.status(400).json({ message: 'Invalid piece data' });
      }

      // Ensure piece is within board boundaries and columns are unique
      if (typeof piece.col !== 'number' || piece.col < 0 || piece.col >= expectedFiles) {
        return res.status(400).json({
          message: `Piece column must be between 0 and ${expectedFiles - 1}`
        });
      }

      if (usedColumns.has(piece.col)) {
        return res.status(400).json({
          message: 'Each column may only contain one piece during setup'
        });
      }
      usedColumns.add(piece.col);

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
    debugLog('Setup - Game stashes:', JSON.stringify(game.stashes));
    debugLog('Setup - Normalized color:', normalizedColor);
    
    if (!game.stashes || !Array.isArray(game.stashes) || game.stashes.length !== 2) {
      debugLog('Setup - Stash validation failed: stashes not properly initialized');
      return res.status(500).json({ message: 'Game stash not properly initialized' });
    }
    
    const stash = game.stashes[normalizedColor];
    debugLog('Setup - Selected stash:', JSON.stringify(stash));
    
    if (!stash || !Array.isArray(stash)) {
      debugLog('Setup - Stash validation failed: selected stash not properly initialized');
      return res.status(500).json({ message: `Stash for color ${normalizedColor} not properly initialized` });
    }
    
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
    debugLog('Setup - Adding action...');
    try {
      game.addAction(
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
      debugLog('Setup - Action added successfully');
    } catch (actionError) {
      console.error('Setup - Action error:', actionError);
      throw actionError;
    }

    // If both players have completed setup, set playerTurn to white (0)
    if (game.setupComplete[0] && game.setupComplete[1]) {
      game.playerTurn = 0;
    }

    transitionStoredClockState(game, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      applyIncrement: false,
      reason: 'setup',
    });

    // Log the final game state before saving
    debugLog('Setup - Final game state before save:');
    debugLog('  - Stashes:', JSON.stringify(game.stashes));
    debugLog('  - Setup complete:', JSON.stringify(game.setupComplete));
    debugLog('  - On decks:', JSON.stringify(game.onDecks));
    debugLog('  - Board:', JSON.stringify(game.board));
    debugLog('  - Player turn:', game.playerTurn);

    try {
      // Validate the game before saving
      debugLog('Setup - Validating game before save...');
      const validationError = game.validateSync();
      if (validationError) {
        console.error('Setup - Validation error:', validationError);
        console.error('Setup - Validation error details:', validationError.errors);
        return res.status(400).json({ 
          message: 'Game validation failed', 
          details: validationError.message 
        });
      }
      
      await game.save();
      debugLog('Setup - Game saved successfully');
    } catch (saveError) {
      console.error('Setup - Save error:', saveError);
      console.error('Setup - Save error details:', saveError.errors);
      throw saveError;
    }

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
      initiator: {
        action: 'setup',
        userId: requesterDetails.userId,
        username: requesterDetails.username,
        isBot: requesterDetails.isBot,
        botDifficulty: requesterDetails.botDifficulty,
      },
    });

    res.json({ message: 'Setup completed successfully' });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message });
  }
});

module.exports = router; 
