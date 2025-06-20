const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, from, to, declaration } = req.body;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    const config = new ServerConfig();
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    if (!game.setupComplete[0] || !game.setupComplete[1]) {
      return res.status(400).json({ message: 'Setup not complete for both players' });
    }

    const fromRow = parseInt(from?.row, 10);
    const fromCol = parseInt(from?.col, 10);
    const toRow = parseInt(to?.row, 10);
    const toCol = parseInt(to?.col, 10);

    const ranks = config.boardDimensions.RANKS;
    const files = config.boardDimensions.FILES;
    const isOnBoard = (r, c) => r >= 0 && r < ranks && c >= 0 && c < files;
    if (!isOnBoard(fromRow, fromCol) || !isOnBoard(toRow, toCol)) {
      return res.status(400).json({ message: 'Coordinates out of bounds' });
    }

    const piece = game.board[fromRow][fromCol];
    if (!piece) {
      return res.status(400).json({ message: 'No piece at from coordinates' });
    }

    if (piece.color !== normalizedColor || game.playerTurn !== normalizedColor) {
      return res.status(400).json({ message: "Not this player's turn" });
    }

    const lastAction = game.actions[game.actions.length - 1];
    if (lastAction && lastAction.type === config.actions.get('BOMB')) {
      return res.status(400).json({ message: 'Cannot move after a bomb action' });
    }

    if (game.onDeckingPlayer === normalizedColor) {
      return res.status(400).json({ message: 'Player must place on-deck piece before moving' });
    }

    const target = game.board[toRow][toCol];
    if (target && target.color === normalizedColor) {
      return res.status(400).json({ message: 'Destination occupied by own piece' });
    }

    const dr = toRow - fromRow;
    const dc = toCol - fromCol;
    const absDr = Math.abs(dr);
    const absDc = Math.abs(dc);

    // Prevent moves where the piece stays in the same square
    if (dr === 0 && dc === 0) {
      return res.status(400).json({ message: 'Piece must move to a different square' });
    }

    const idents = config.identities;
    let legal = false;

    switch (parseInt(declaration, 10)) {
      case idents.get('KNIGHT'):
        legal = (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
        break;
      case idents.get('KING'):
        legal = absDr <= 1 && absDc <= 1 && (absDr !== 0 || absDc !== 0);
        break;
      case idents.get('BISHOP'):
        // Bishop moves diagonally up to 3 squares
        if (absDr === absDc && absDr > 0 && absDr <= 3) {
          legal = true;
          // Calculate step direction for checking path
          const stepR = dr > 0 ? 1 : -1;
          const stepC = dc > 0 ? 1 : -1;
          // Check each square along the path for blocking pieces
          for (let i = 1; i < absDr; i++) {
            if (game.board[fromRow + i * stepR][fromCol + i * stepC]) {
              legal = false;
              break;
            }
          }
        }
        break;
      case idents.get('ROOK'):
        // Rook moves horizontally or vertically up to 3 squares
        if ((dr === 0 || dc === 0) && (absDr + absDc > 0) && absDr <= 3 && absDc <= 3) {
          legal = true;
          // Calculate step direction for checking path
          const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
          const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;
          // Get the maximum distance to check
          const distance = Math.max(absDr, absDc);
          // Check each square along the path for blocking pieces
          for (let i = 1; i < distance; i++) {
            if (game.board[fromRow + i * stepR][fromCol + i * stepC]) {
              legal = false;
              break;
            }
          }
        }
        break;
      default:
        return res.status(400).json({ message: 'Invalid declaration' });
    }

    if (!legal) {
      return res.status(400).json({ message: 'Illegal move' });
    }

    const move = {
      player: normalizedColor,
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      declaration: parseInt(declaration, 10),
      state: config.moveStates.get('PENDING'),
      timestamp: new Date()
    };

    if (game.moves.length > 0) {
      const prevMove = game.moves[game.moves.length - 1];

      if (prevMove.state === config.moveStates.get('PENDING')) {
        const { from: pf, to: pt } = prevMove;
        const movingPiece = game.board[pf.row][pf.col];
        const targetPiece = game.board[pt.row][pt.col];

        if (targetPiece) {
          game.captured[targetPiece.color].push(targetPiece);
        }

        game.board[pt.row][pt.col] = movingPiece;
        game.board[pf.row][pf.col] = null;

        const kingId = config.identities.get('KING');
        if (targetPiece && targetPiece.identity === kingId) {
          await game.endGame(prevMove.player, config.winReasons.get('CAPTURED_KING'));
        } else if (prevMove.declaration === kingId) {
          const throneRow = prevMove.player === 0 ? config.boardDimensions.RANKS - 1 : 0;
          if (pt.row === throneRow) {
            await game.endGame(prevMove.player, config.winReasons.get('THRONE'));
          }
        }

        prevMove.state = config.moveStates.get('RESOLVED');

        if (targetPiece) {
          game.movesSinceAction = 0;
        } else {
          game.movesSinceAction += 1;
          if (game.movesSinceAction >= 20 && game.isActive) {
            await game.endGame(null, config.winReasons.get('DRAW'));
          }
        }
      }
    }

    if (!game.isActive) {
      return res.json({ message: 'Game drawn by inactivity' });
    }

    game.moves.push(move);

    // Flip turn to the other player after recording the move
    game.playerTurn = normalizedColor === 0 ? 1 : 0;

    await game.addAction(config.actions.get('MOVE'), normalizedColor, {
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      declaration: parseInt(declaration, 10)
    });

    await game.save();

    res.json({ message: 'Move recorded' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
