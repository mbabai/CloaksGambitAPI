import { ACTIONS, MOVE_STATES } from '../assets/constants.js'

export function canChallenge({ game, lastAction, lastMove, myColor }) {
  const isMyTurn = Boolean(game?.isActive && game?.playerTurn === myColor)
  if (!isMyTurn || !lastAction) return false
  if (lastAction.type === ACTIONS.MOVE) {
    if (!lastMove || lastMove.state !== MOVE_STATES.PENDING) return false
    return lastMove.player !== myColor
  }
  if (lastAction.type === ACTIONS.BOMB) {
    return lastAction.player !== myColor && lastAction.state === MOVE_STATES.PENDING
  }
  return false
}

export function canBomb({ game, lastAction, lastMove, myColor }) {
  const isMyTurn = Boolean(game?.isActive && game?.playerTurn === myColor)
  if (!isMyTurn || !lastAction || !lastMove) return false
  if (lastAction.type !== ACTIONS.MOVE) return false
  if (lastMove.player === myColor || lastMove.state !== MOVE_STATES.PENDING) return false
  const tgt = lastMove.to
  const pieceAtTarget = game.board?.[tgt.row]?.[tgt.col]
  return Boolean(pieceAtTarget && pieceAtTarget.color === myColor)
}
