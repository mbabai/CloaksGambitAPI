import React, { useMemo, useState } from 'react'
import PlayerState from './PlayerState.jsx'
import Board from './Board.jsx'
import Stash from './Stash.jsx'
import ActionButtons from './ActionButtons.jsx'
import Queuer from './Queuer.jsx'
import MatchFoundBanner from './MatchFoundBanner.jsx'
import PlayArea from './PlayArea.jsx'
import styles from './GameUI.module.css'
import { useGameClient } from '../model/useGameClient.js'
import { canChallenge as canChallengeSel, canBomb as canBombSel } from '../model/selectors.js'
import { PIECE_IMAGES } from '../assets/pieces.js'
import { BOARD_ROWS, BOARD_COLS, STASH_ROWS, STASH_COLS } from '../assets/constants.js'
import { calcLayout } from '../lib/layout.js'

export default function GameUI() {
  const { state, send, queue } = useGameClient()
  const { game, perspective, activeGame, justMatched, isQueuedServer, pendingAction } = state

  const [layout, setLayout] = useState(() =>
    calcLayout({ width: 0, height: 0 }, { rows: BOARD_ROWS, cols: BOARD_COLS, stashRows: STASH_ROWS, stashCols: STASH_COLS })
  )

  const handleResize = (dims) => {
    setLayout(calcLayout(dims, { rows: BOARD_ROWS, cols: BOARD_COLS, stashRows: STASH_ROWS, stashCols: STASH_COLS }))
  }

  const identityToImg = useMemo(() => PIECE_IMAGES, [])
  const lastAction = game.actions && game.actions.length > 0 ? game.actions[game.actions.length - 1] : null
  const lastMove = game.moves && game.moves.length > 0 ? game.moves[game.moves.length - 1] : null
  const myColor = activeGame ? activeGame.color : 0

  const canChallenge = useMemo(() => canChallengeSel({ game, lastAction, lastMove, myColor }), [game, lastAction, lastMove, myColor])
  const canBomb = useMemo(() => canBombSel({ game, lastAction, lastMove, myColor }), [game, lastAction, lastMove, myColor])

  return (
    <div className={styles.viewport}>
      <PlayArea className={styles.playArea} style={layout.cssVars} onResize={handleResize}>
        <div className={styles.gameState} style={{ top: layout.positions.gameStateTop, height: layout.sizes.gameStateHeight }}>
          <PlayerState
            position="top"
            playerName="Opponent Name"
            playerColor={perspective === 'white' ? 1 : 0}
            sizes={layout.sizes}
            positions={layout.positions}
            identityToImg={identityToImg}
            daggerCount={game?.daggers?.[perspective === 'white' ? 1 : 0] || 0}
            capturedPieces={game?.captured?.[perspective === 'white' ? 1 : 0] || []}
          />
          <PlayerState
            position="bottom"
            playerName="My Name"
            playerColor={perspective === 'white' ? 0 : 1}
            sizes={layout.sizes}
            positions={layout.positions}
            identityToImg={identityToImg}
            daggerCount={game?.daggers?.[perspective === 'white' ? 0 : 1] || 0}
            capturedPieces={game?.captured?.[perspective === 'white' ? 0 : 1] || []}
          />
        </div>

        <Board
          board={game.board}
          perspective={perspective}
          sizes={layout.sizes}
          positions={layout.positions}
          identityToImg={identityToImg}
        />

        <Stash
          sizes={layout.sizes}
          positions={layout.positions}
          identityToImg={identityToImg}
          stashPieces={game?.stashes?.[perspective === 'white' ? 0 : 1] || []}
          onDeckPiece={game?.onDecks?.[perspective === 'white' ? 0 : 1] || null}
        />

        <ActionButtons
          sizes={layout.sizes}
          positions={layout.positions}
          onChallenge={send.challenge}
          onPass={() => {}}
          onBomb={send.bomb}
          canChallenge={canChallenge}
          canBomb={canBomb}
        />

        {justMatched && <MatchFoundBanner seconds={justMatched.seconds} />}

        {!activeGame && (
          <Queuer
            sizes={layout.sizes}
            positions={layout.positions}
            mode={queue.mode}
            isSearching={pendingAction === 'join' || isQueuedServer}
            onToggleSearch={queue.toggle}
            onChangeMode={queue.setMode}
          />
        )}
      </PlayArea>
    </div>
  )
}
