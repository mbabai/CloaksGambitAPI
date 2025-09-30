const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    
    console.log('Challenge request:', { gameId, color });

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    const config = await getServerConfig();

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is already ended' });
    }

    if (game.playerTurn !== normalizedColor) {
      return res.status(400).json({ message: 'Not this player\'s turn' });
    }

    const lastAction = game.actions[game.actions.length - 1];
    if (!lastAction) {
      return res.status(400).json({ message: 'No previous action to challenge' });
    }
    
    console.log('Last action:', lastAction);
    console.log('Game moves:', game.moves);
    console.log('Game actions:', game.actions);
    console.log('Game board:', game.board);
    console.log('Game stashes:', game.stashes);
    console.log('Game onDecks:', game.onDecks);
    console.log('Game captured:', game.captured);
    console.log('Game daggers:', game.daggers);

    const moveType = config.actions.get('MOVE');
    const bombType = config.actions.get('BOMB');

    const lastMove = game.moves && game.moves.length > 0 ? game.moves[game.moves.length - 1] : null;

    if (lastAction.type === moveType) {
      if (!lastMove) {
        return res.status(400).json({ message: 'No move found to challenge' });
      }
      if (lastMove.state !== config.moveStates.get('PENDING')) {
        return res.status(400).json({ message: 'No pending move to challenge' });
      }
    } else if (lastAction.type === bombType) {
      if (!lastMove) {
        return res.status(400).json({ message: 'No move found to challenge bomb' });
      }
    } else {
      return res.status(400).json({ message: 'Last action cannot be challenged' });
    }

    // Ensure game state arrays exist
    if (!game.captured || !Array.isArray(game.captured) || game.captured.length !== 2) {
      return res.status(500).json({ message: 'Invalid game state: captured array missing' });
    }
    
    if (!game.daggers || !Array.isArray(game.daggers) || game.daggers.length !== 2) {
      return res.status(500).json({ message: 'Invalid game state: daggers array missing' });
    }
    
    if (!game.stashes || !Array.isArray(game.stashes) || game.stashes.length !== 2) {
      return res.status(500).json({ message: 'Invalid game state: stashes array missing' });
    }
    
    if (!game.onDecks || !Array.isArray(game.onDecks) || game.onDecks.length !== 2) {
      return res.status(500).json({ message: 'Invalid game state: onDecks array missing' });
    }
    
    if (!game.board || !Array.isArray(game.board) || game.board.length === 0) {
      return res.status(500).json({ message: 'Invalid game state: board missing or empty' });
    }
    
    if (!game.board[0] || !Array.isArray(game.board[0]) || game.board[0].length === 0) {
      return res.status(500).json({ message: 'Invalid game state: board dimensions invalid' });
    }

    if (game.onDeckingPlayer === normalizedColor) {
      return res.status(400).json({ message: 'On-decking player cannot challenge' });
    }

    let capturedPiece = null;
    let captureBy = null;
    let trueKing = false;
    let wasSuccessful = false; // Whether the challenger succeeded

    if (lastAction.type === moveType) {
      console.log('Processing move challenge, lastMove:', lastMove);
      
      // Ensure lastMove has a player property
      if (typeof lastMove.player !== 'number' || (lastMove.player !== 0 && lastMove.player !== 1)) {
        return res.status(400).json({ message: 'Invalid move player information' });
      }
      
      const from = lastMove.from;
      const to = lastMove.to;
      
      console.log('Move coordinates:', { from, to });
      
      // Validate board coordinates
      if (!from || !to || 
          typeof from.row !== 'number' || typeof from.col !== 'number' ||
          typeof to.row !== 'number' || typeof to.col !== 'number' ||
          from.row < 0 || from.row >= game.board.length ||
          from.col < 0 || from.col >= game.board[0].length ||
          to.row < 0 || to.row >= game.board.length ||
          to.col < 0 || to.col >= game.board[0].length) {
        console.log('Invalid coordinates:', { from, to, boardLength: game.board.length, boardWidth: game.board[0]?.length });
        return res.status(400).json({ message: 'Invalid move coordinates' });
      }
      
      const pieceFrom = game.board[from.row][from.col];
      const pieceTo = game.board[to.row][to.col];
      
      console.log('Board pieces:', { pieceFrom, pieceTo });

      if (!pieceFrom) {
        return res.status(400).json({ message: 'Invalid move state' });
      }

      if (pieceFrom.identity !== lastMove.declaration) {
        capturedPiece = pieceFrom;
        captureBy = normalizedColor;
        game.captured[normalizedColor].push(pieceFrom);
        game.board[from.row][from.col] = null;
        lastMove.state = config.moveStates.get('RESOLVED');
        wasSuccessful = true; // Challenger proved a lie

        // Clear any existing on-deck requirement since the challenge
        // succeeded and play should pass normally to the challenger.
        game.onDeckingPlayer = null;
      } else {
        lastMove.state = config.moveStates.get('COMPLETED');
        game.daggers[normalizedColor] += 1;
        wasSuccessful = false; // Challenger failed

        if (
          lastMove.declaration === config.identities.get('KING') &&
          pieceFrom.identity === config.identities.get('KING')
        ) {
          trueKing = true;
        }

        if (pieceTo && pieceTo.color !== pieceFrom.color) {
          capturedPiece = pieceTo;
          captureBy = lastMove.player; // The original mover captures the challenging piece
          game.captured[lastMove.player].push(pieceTo); // Store in original mover's array
          
          console.log('Move challenge failed - capturing challenging piece:', {
            pieceTo: pieceTo,
            captureBy: captureBy,
            storedInArray: lastMove.player,
            challengerColor: normalizedColor
          });
        }

        game.stashes[lastMove.player].push(pieceFrom);
        game.board[from.row][from.col] = null;

        const deckPiece = game.onDecks[lastMove.player];
        game.board[to.row][to.col] = deckPiece;
        game.onDecks[lastMove.player] = null;

        // The challenger (who failed the challenge) needs to go on-deck, not the original mover
        game.onDeckingPlayer = 1 - normalizedColor; // Opposite of challenger (1 - challenger)
        game.playerTurn = 1 - normalizedColor;      // It's the opposite player's turn to go on-deck

        console.log('Move challenge failed - setting on-deck state:', {
          challengerColor: normalizedColor,
          oppositeColor: 1 - normalizedColor,
          onDeckingPlayer: game.onDeckingPlayer,
          playerTurn: game.playerTurn
        });
      }
    } else if (lastAction.type === bombType) {
      // For bomb actions, we need a valid lastMove
      if (!lastMove) {
        return res.status(400).json({ message: 'No move found to challenge bomb' });
      }
      
      // Ensure lastMove has a player property
      if (typeof lastMove.player !== 'number' || (lastMove.player !== 0 && lastMove.player !== 1)) {
        return res.status(400).json({ message: 'Invalid move player information' });
      }
      
      const from = lastMove.from;
      const to = lastMove.to;
      
      // Validate board coordinates
      if (!from || !to || 
          typeof from.row !== 'number' || typeof from.col !== 'number' ||
          typeof to.row !== 'number' || typeof to.col !== 'number' ||
          from.row < 0 || from.row >= game.board.length ||
          from.col < 0 || from.col >= game.board[0].length ||
          to.row < 0 || to.row >= game.board.length ||
          to.col < 0 || to.col >= game.board[0].length) {
        return res.status(400).json({ message: 'Invalid bomb coordinates' });
      }
      
      const pieceFrom = game.board[from.row][from.col];
      const pieceTo = game.board[to.row][to.col];

      if (!pieceFrom) {
        return res.status(400).json({ message: 'Invalid bomb state' });
      }

      const bombId = config.identities.get('BOMB');

      if (!pieceTo || pieceTo.identity !== bombId) {
        if (pieceTo) {
          capturedPiece = pieceTo;
          captureBy = lastMove.player;
          game.captured[lastMove.player].push(pieceTo);
          game.daggers[pieceTo.color] += 1;
        }

        game.board[to.row][to.col] = pieceFrom;
        game.board[from.row][from.col] = null;
        lastMove.state = config.moveStates.get('RESOLVED');
        wasSuccessful = true;

        // A successful bomb challenge means no player needs to go on-deck.
        // Explicitly clear any leftover on-deck state to ensure the
        // challenger can move next.
        game.onDeckingPlayer = null;
      } else {
        game.stashes[pieceTo.color].push(pieceTo);
        const deckPiece = game.onDecks[pieceTo.color];
        game.board[to.row][to.col] = deckPiece;
        game.onDecks[pieceTo.color] = null;
        
        // The challenger (who failed the challenge) needs to go on-deck, not the original mover
        game.onDeckingPlayer = 1 - normalizedColor; // Opposite of challenger (1 - challenger)
        game.playerTurn = 1 - normalizedColor;      // It's the opposite player's turn to go on-deck

        console.log('Bomb challenge failed - setting on-deck state:', {
          challengerColor: normalizedColor,
          oppositeColor: 1 - normalizedColor,
          onDeckingPlayer: game.onDeckingPlayer,
          playerTurn: game.playerTurn
        });

        if (pieceFrom) {
          capturedPiece = pieceFrom;
          captureBy = pieceTo.color;
          game.captured[1 - normalizedColor].push(pieceFrom); // Store in opposite of challenger's array
          game.board[from.row][from.col] = null;
          
          console.log('Bomb challenge failed - capturing original piece:', {
            pieceFrom: pieceFrom,
            captureBy: captureBy,
            storedInArray: 1 - normalizedColor,
            challengerColor: normalizedColor
          });
        }

        // Failed bomb challenges penalize the challenger with a dagger token
        game.daggers[normalizedColor] += 1;
        lastMove.state = config.moveStates.get('COMPLETED');
        wasSuccessful = false;
      }
    } else {
      return res.status(400).json({ message: 'Last action type cannot be challenged' });
    }

    // Handle turn logic after challenge resolution
    if (game.onDeckingPlayer !== null) {
      // If someone needs to go on-deck, it's their turn
      game.playerTurn = game.onDeckingPlayer;
    } else if (lastMove) {
      // If no one needs to go on-deck, turn goes to the opponent of the last mover
      game.playerTurn = lastMove.player === 0 ? 1 : 0;
    }

    // Add debugging for turn logic
    console.log('Challenge turn logic debug:', {
      wasSuccessful,
      onDeckingPlayer: game.onDeckingPlayer,
      playerTurn: game.playerTurn,
      lastMovePlayer: lastMove ? lastMove.player : null,
      challengeColor: normalizedColor
    });

    await game.addAction(
      config.actions.get('CHALLENGE'),
      normalizedColor,
      {
        outcome: wasSuccessful ? 'SUCCESS' : 'FAIL'
      }
    );
    game.movesSinceAction = 0;
    // Persist challenge resolution and updated action log
    await game.save();

    if (trueKing && game.isActive) {
      await game.endGame(lastMove.player, config.winReasons.get('TRUE_KING'));
      // Check if game ended and return early
      if (!game.isActive) {
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({
          success: wasSuccessful,
          message: 'Game ended: True king victory',
          capturedPiece,
          captureBy,
          trueKing
        });
      }
    }

    if (
      capturedPiece &&
      capturedPiece.identity === config.identities.get('KING') &&
      game.isActive
    ) {
      await game.endGame(captureBy, config.winReasons.get('CAPTURED_KING'));
      // Check if game ended and return early
      if (!game.isActive) {
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({
          success: wasSuccessful,
          message: 'Game ended: King captured',
          capturedPiece,
          captureBy,
          trueKing
        });
      }
    }

    if (game.isActive && (game.daggers[0] >= 3 || game.daggers[1] >= 3)) {
      // The player who amasses three daggers loses
      const loser = game.daggers[0] >= 3 ? 0 : 1;
      const winner = 1 - loser;
      await game.endGame(winner, config.winReasons.get('DAGGERS'));
      // Check if game ended and return early
      if (!game.isActive) {
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({
          success: wasSuccessful,
          message: 'Game ended: dagger penalty',
          capturedPiece,
          captureBy,
          trueKing
        });
      }
    }

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    res.json({ 
      success: wasSuccessful, 
      message: 'Challenge processed successfully',
      capturedPiece,
      captureBy,
      trueKing
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 