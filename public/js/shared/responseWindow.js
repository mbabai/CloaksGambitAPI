import { ACTIONS, MOVE_STATES } from './gameConstants.js';

export function getResponseWindowState({
  isMyTurn = false,
  isInSetup = false,
  currentOnDeckingPlayer = null,
  myColor = null,
  lastMove = null,
  lastAction = null,
  lastMoveAction = null,
  latestMoveContext = null,
} = {}) {
  const responseContext = latestMoveContext || null;
  const pendingResponse = Boolean(
    (lastMove && lastMove.state === MOVE_STATES.PENDING)
    || responseContext?.isPending
  );
  const responseAction = (
    lastAction && (lastAction.type === ACTIONS.MOVE || lastAction.type === ACTIONS.BOMB)
      ? lastAction
      : (lastMoveAction && (lastMoveAction.type === ACTIONS.MOVE || lastMoveAction.type === ACTIONS.BOMB)
        ? lastMoveAction
        : (responseContext?.action && (responseContext.action.type === ACTIONS.MOVE || responseContext.action.type === ACTIONS.BOMB)
          ? responseContext.action
          : null))
  );

  let responseActor = null;
  if (responseAction?.type === ACTIONS.BOMB) {
    responseActor = typeof responseAction.player === 'number'
      ? responseAction.player
      : null;
  } else {
    responseActor = typeof responseContext?.action?.player === 'number'
      ? responseContext.action.player
      : (typeof responseContext?.actor === 'number' ? responseContext.actor : lastMove?.player);
  }

  const responseWindowOpen = Boolean(
    isMyTurn
    && !isInSetup
    && currentOnDeckingPlayer !== myColor
    && pendingResponse
    && responseActor !== myColor
  );

  return {
    pendingResponse,
    responseAction,
    responseActor,
    responseWindowOpen,
  };
}
