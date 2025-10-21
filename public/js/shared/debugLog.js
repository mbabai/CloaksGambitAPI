import * as CONST from './gameConstants.js';
import { getLatestMoveContext } from './latestMoveContext.js';

let bootPrinted = false;

export function logBootConstantsOnce() {
  if (bootPrinted) return;
  bootPrinted = true;
  try {
    // eslint-disable-next-line no-console
    console.groupCollapsed('%c[Game Boot] Constants', 'color:#888');
    // eslint-disable-next-line no-console
    console.log('ACTIONS:', CONST.ACTIONS);
    // eslint-disable-next-line no-console
    console.log('MOVE_STATES:', CONST.MOVE_STATES);
    // eslint-disable-next-line no-console
    console.log('PIECE_TYPES:', CONST.IDENTITIES);
    if (CONST.PIECE_IDENTITIES) {
      // eslint-disable-next-line no-console
      console.log('PIECE_IDENTITIES:', CONST.PIECE_IDENTITIES);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[logBootConstantsOnce] failed:', err);
  }
}

export function logGameSnapshot(tag, game) {
  try {
    const ctx = getLatestMoveContext(game || {});
    const boardSig = Array.isArray(game?.board)
      ? `${game.board.length}x${game.board[0]?.length}`
      : typeof game?.board;

    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `%c[${tag}] gameId=${game?._id || game?.id || '?'} turn=${game?.turn ?? '?'} actions=${Array.isArray(game?.actions) ? game.actions.length : 0} moves=${Array.isArray(game?.moves) ? game.moves.length : 0}`,
      'color:#6a5acd'
    );
    // eslint-disable-next-line no-console
    console.log('snapshot:', game);
    // eslint-disable-next-line no-console
    console.log('boardSig:', boardSig);
    // eslint-disable-next-line no-console
    console.log('latestMoveContext:', ctx);
    // eslint-disable-next-line no-console
    console.groupEnd();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[logGameSnapshot] failed:', err);
  }
}
