import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import styles from './GameUI.module.css'
import PlayerState from './parts/PlayerState.jsx'
import Board from './parts/Board.jsx'
import Stash from './parts/Stash.jsx'
import ActionButtons from './parts/ActionButtons.jsx'
import Queuer from './parts/Queuer.jsx'
import MatchFoundBanner from './parts/MatchFoundBanner.jsx'
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
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null]
  ],
  stashes: [
    [null, null, null, null, null],
    [null, null, null, null, null]
  ],
  daggers: [0, 0],
  captured: [
    [],
    []
  ]
}

export default function GameUI() {
  const [perspective, setPerspective] = useState('white')
  const [game, setGame] = useState(sampleGameState)
  const [mode, setMode] = useState('quickplay')
  const [isQueuedServer, setIsQueuedServer] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [justMatched, setJustMatched] = useState(null) // { gameId, seconds }
  const socketRef = useRef(null)
  const viewportRef = useRef(null)
  const containerRef = useRef(null)
  const lastBannerGameIdRef = useRef(null)
  // Measure the viewport wrapper so the play area can grow/shrink dynamically
  const layout = usePlayAreaLayout(viewportRef, { rows: BOARD_ROWS, cols: BOARD_COLS, stashRows: STASH_ROWS, stashCols: STASH_COLS })

  const identityToChar = useMemo(() => PIECE_IDENTITIES, [])

  // Wire socket to receive initial state and game updates
  useEffect(() => {
    const userId = document.cookie.match(/(?:^|; )userId=([^;]+)/)?.[1]
    if (!userId) return
    const socket = io('/', { auth: { userId } })
    socketRef.current = socket
    socket.on('initialState', ({ queued, games }) => {
      setIsQueuedServer(Boolean(queued?.quickplay))
      setPendingAction(null)
      if (Array.isArray(games) && games.length > 0) {
        const g = games[0]
        const existingId = g.gameId || g._id
        setActiveGame({ id: existingId, color: g.players?.findIndex?.(p => p === userId) ?? 0 })
        // Do not show banner for existing game on page load
        lastBannerGameIdRef.current = existingId
        setPerspective((g.players?.findIndex?.(p => p === userId) ?? 0) === 0 ? 'white' : 'black')
      }
    })
    socket.on('queue:update', (payload) => {
      setIsQueuedServer(Boolean(payload?.quickplay))
      setPendingAction(null)
    })
    socket.on('game:update', (payload) => {
      // When game becomes active, hide queue and display board from server perspective
      if (payload && payload.board) {
        const colorIdx = payload.players?.findIndex?.(p => p === userId) ?? 0
        const nextGameId = payload.gameId
        const isNewGame = lastBannerGameIdRef.current !== nextGameId
        setActiveGame({ id: nextGameId, color: colorIdx })
        setPerspective(((payload.players?.findIndex?.(p => p === userId) ?? 0) === 0) ? 'white' : 'black')
        setGame({
          board: payload.board,
          stashes: payload.stashes,
          daggers: payload.daggers,
          captured: payload.captured,
          actions: payload.actions,
          moves: payload.moves,
          playerTurn: payload.playerTurn,
          onDeckingPlayer: payload.onDeckingPlayer,
          isActive: payload.isActive,
          winner: payload.winner,
          winReason: payload.winReason
        })

        // Trigger one-shot "match found" countdown only when a new game appears
        if (isNewGame) {
          setJustMatched({ gameId: nextGameId, seconds: 3 })
          lastBannerGameIdRef.current = nextGameId
        }
      }
    })
    return () => socket.disconnect()
  }, [])

  // Countdown effect for the match-found banner; auto-sends READY at 1s
  useEffect(() => {
    if (!justMatched) return
    if (!activeGame) return
    if (justMatched.gameId !== activeGame.id) return

    if (justMatched.seconds <= 0) {
      setJustMatched(null)
      return
    }

    const timer = setTimeout(async () => {
      const next = justMatched.seconds - 1
              // When reaching 0 seconds, send READY
        if (next === 0) {
          try {
            const color = activeGame.color
            console.log('[game] sending READY at 0s', { gameId: activeGame.id, color })
            await fetch('/api/v1/gameAction/ready', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gameId: activeGame.id, color })
            })
          } catch (e) {
            console.error('Failed to send READY:', e)
          }
        }
      setJustMatched({ ...justMatched, seconds: next })
    }, 1000)

    return () => clearTimeout(timer)
  }, [justMatched, activeGame])

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

      {justMatched && (
        <MatchFoundBanner seconds={justMatched.seconds} />
      )}

      {!activeGame && (
        <Queuer
          sizes={layout.sizes}
          positions={layout.positions}
          mode={mode}
          isSearching={pendingAction === 'join' || isQueuedServer}
          onToggleSearch={async () => {
            if (mode !== 'quickplay') return alert('This queue is still under construction!')
            try {
              const userId = document.cookie.match(/(?:^|; )userId=([^;]+)/)?.[1]
              if (!userId) return
              const leaving = (pendingAction === 'join' || isQueuedServer)
              const url = leaving ? '/api/v1/lobby/exitQuickplay' : '/api/v1/lobby/enterQuickplay'
              setPendingAction(leaving ? 'leave' : 'join')
              const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: decodeURIComponent(userId) }) })
              if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.message || 'Queue error')
              }
              // Wait for socket queue:update to finalize state
            } catch (e) { console.error(e); setPendingAction(null) }
          }}
          onChangeMode={(m) => setMode(m)}
        />
      )}
      </div>
    </div>
  )
}

