import React, { useEffect, useMemo, useRef, useState } from 'react'
import styles from './GameUI.module.css'
import PlayerState from './parts/PlayerState.jsx'
import Board from './parts/Board.jsx'
import Stash from './parts/Stash.jsx'
import ActionButtons from './parts/ActionButtons.jsx'
import Queuer from './parts/Queuer.jsx'
import { usePlayAreaLayout } from './hooks/usePlayAreaLayout.js'

const BOARD_ROWS = 6
const BOARD_COLS = 5
const STASH_ROWS = 2
const STASH_COLS = 5

const PIECE_IDENTITIES = {
  0: '?',
  1: '♔',
  2: '💣',
  3: '♗',
  4: '♖',
  5: '♘'
}

const sampleGameState = {
  board: [
    [{ color: 0, identity: 1 }, { color: 0, identity: 4 }, null, null, null],
    [null, null, null, null, null],
    [null, { color: 0, identity: 0 }, null, null, null],
    [null, null, null, null, { color: 1, identity: 0 }],
    [null, null, { color: 1, identity: 0 }, null, null],
    [{ color: 1, identity: 0 }, { color: 1, identity: 0 }, { color: 1, identity: 0 }, null, null]
  ],
  stashes: [
    [
      { color: 0, identity: 1 }, { color: 0, identity: 2 }, null, { color: 0, identity: 5 }, { color: 0, identity: 5 }
    ],
    [
      { color: 1, identity: 4 }, { color: 1, identity: 4 }, { color: 1, identity: 3 }, { color: 1, identity: 3 }, { color: 1, identity: 2 }
    ]
  ],
  daggers: [2, 2],
  captured: [
    [{ color: 0, identity: 3 }],
    [{ color: 1, identity: 0 }, { color: 1, identity: 0 }]
  ]
}

export default function GameUI() {
  const [perspective, setPerspective] = useState('white')
  const [game, setGame] = useState(sampleGameState)
  const viewportRef = useRef(null)
  const containerRef = useRef(null)
  // Measure the viewport wrapper so the play area can grow/shrink dynamically
  const layout = usePlayAreaLayout(viewportRef, { rows: BOARD_ROWS, cols: BOARD_COLS, stashRows: STASH_ROWS, stashCols: STASH_COLS })

  const identityToChar = useMemo(() => PIECE_IDENTITIES, [])

  // Expose a console helper to flip perspective without UI button
  useEffect(() => {
    window.flipBoard = () => setPerspective(p => (p === 'white' ? 'black' : 'white'))
    return () => { try { delete window.flipBoard } catch (_) { window.flipBoard = undefined } }
  }, [])

  return (
    <div ref={viewportRef} className={styles.viewport}>
      <div ref={containerRef} className={styles.playArea} style={layout.cssVars}>
        <div className={styles.gameState} style={{ top: layout.positions.gameStateTop, height: layout.sizes.gameStateHeight }}>
        <PlayerState
          side="left"
          perspective={perspective}
          daggers={game.daggers}
          captured={game.captured}
          sizes={layout.sizes}
          identityToChar={identityToChar}
        />
        <PlayerState
          side="right"
          perspective={perspective}
          daggers={game.daggers}
          captured={game.captured}
          sizes={layout.sizes}
          identityToChar={identityToChar}
        />
        </div>

      <Board
        board={game.board}
        perspective={perspective}
        sizes={layout.sizes}
        positions={layout.positions}
        identityToChar={identityToChar}
      />

      <Stash
        stashes={game.stashes}
        sizes={layout.sizes}
        positions={layout.positions}
        identityToChar={identityToChar}
      />

      <ActionButtons
        sizes={layout.sizes}
        positions={layout.positions}
        onChallenge={() => {}}
        onPass={() => {}}
        onBomb={() => {}}
      />

      <Queuer
        sizes={layout.sizes}
        positions={layout.positions}
        onChangeMode={() => {}}
      />
      </div>
    </div>
  )
}

