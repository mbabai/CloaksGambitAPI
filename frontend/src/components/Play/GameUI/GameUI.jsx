import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import styles from './GameUI.module.css'
import PlayerState from './parts/PlayerState.jsx'
import Board from './parts/Board.jsx'
import Stash from './parts/Stash.jsx'
import ActionButtons from './parts/ActionButtons.jsx'
import Queuer from './parts/Queuer.jsx'
import MatchFoundBanner from './parts/MatchFoundBanner.jsx'
import PlayArea from './PlayArea.jsx'
import { usePlayAreaLayout } from './hooks/usePlayAreaLayout.js'

const BOARD_ROWS = 6
const BOARD_COLS = 5
const STASH_ROWS = 2
const STASH_COLS = 5

// Action and move state constants mirrored from server config
const ACTIONS = {
  MOVE: 1,
  CHALLENGE: 2,
  BOMB: 3
}

const MOVE_STATES = {
  PENDING: 0
}

// Map piece identity and color to image paths located in public/assets/images/Pieces
const PIECE_IMAGES = {
  0: {
    0: '/assets/images/Pieces/PawnWhiteUnknown.svg',
    1: '/assets/images/Pieces/PawnBlackUnknown.svg'
  },
  1: {
    0: '/assets/images/Pieces/PawnWhiteKing.svg',
    1: '/assets/images/Pieces/PawnBlackKing.svg'
  },
  2: {
    0: '/assets/images/Pieces/PawnWhiteBomb.svg',
    1: '/assets/images/Pieces/PawnBlackBomb.svg'
  },
  3: {
    0: '/assets/images/Pieces/PawnWhiteBishop.svg',
    1: '/assets/images/Pieces/PawnBlackBishop.svg'
  },
  4: {
    0: '/assets/images/Pieces/PawnWhiteRook.svg',
    1: '/assets/images/Pieces/PawnBlackRook.svg'
  },
  5: {
    0: '/assets/images/Pieces/PawnWhiteKnight.svg',
    1: '/assets/images/Pieces/PawnBlackKnight.svg'
  }
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
  ],
  onDecks: [null, null]
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
  const [bothReady, setBothReady] = useState(false)
  // Measure the viewport wrapper so the play area can grow/shrink dynamically
  const layout = usePlayAreaLayout(viewportRef, { rows: BOARD_ROWS, cols: BOARD_COLS, stashRows: STASH_ROWS, stashCols: STASH_COLS })

  const identityToImg = useMemo(() => PIECE_IMAGES, [])

  // Determine API origin for dev (vite on 5173) vs prod (same origin)
  const API_ORIGIN = (import.meta.env?.VITE_API_ORIGIN) || (window.location.origin.includes(':5173') ? 'http://localhost:3000' : window.location.origin)

  // Wire socket to receive initial state and game updates
  useEffect(() => {
    let isMounted = true

    async function ensureUserId() {
      const match = document.cookie.match(/(?:^|; )userId=([^;]+)/)
      if (match) return decodeURIComponent(match[1])
      const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const username = 'guest_' + nonce
      const email = nonce + '@guest.local'
      const res = await fetch(`${API_ORIGIN}/api/v1/users/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email })
      })
      if (!res.ok) throw new Error('Failed to create guest user')
      const user = await res.json()
      const id = user && user._id
      document.cookie = `userId=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`
      return id
    }

    (async () => {
      try {
        const userId = await ensureUserId()
        if (!isMounted) return
        const socket = io(API_ORIGIN, { auth: { userId } })
        socketRef.current = socket
        socket.on('initialState', ({ queued, games }) => {
          setIsQueuedServer(Boolean(queued?.quickplay))
          setPendingAction(null)
          if (Array.isArray(games) && games.length > 0) {
            // Reconnect flow: pick the most recent active game and jump in immediately
            const g = games[0]
            const existingId = g.gameId || g._id
            const colorIdx = g.players?.findIndex?.(p => p === userId) ?? 0
            setActiveGame({ id: existingId, color: colorIdx })
            setPerspective(colorIdx === 0 ? 'white' : 'black')
            lastBannerGameIdRef.current = existingId
            setBothReady(Boolean(g?.playersReady?.[0] && g?.playersReady?.[1]))

            // If not ready yet, send READY immediately on reconnect
            const isReady = Array.isArray(g?.playersReady) ? Boolean(g.playersReady[colorIdx]) : false
            if (!isReady) {
              ;(async () => {
                try {
                  console.log('[client] reconnect sending READY immediately', { gameId: existingId, color: colorIdx })
                  await fetch(`${API_ORIGIN}/api/v1/gameAction/ready`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameId: existingId, color: colorIdx })
                  })
                } catch (e) {
                  console.error('READY on reconnect failed', e)
                }
              })()
            }
          }
        })
        socket.on('queue:update', (payload) => {
          setIsQueuedServer(Boolean(payload?.quickplay))
          setPendingAction(null)
        })
        socket.on('game:update', (payload) => {
          console.log('[client] game:update', {
            gameId: payload?.gameId,
            playersReady: payload?.playersReady,
            playerTurn: payload?.playerTurn
          })
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
              winReason: payload.winReason,
              onDecks: payload.onDecks
            })

            if (Array.isArray(payload.playersReady) && payload.playersReady[0] && payload.playersReady[1]) {
              setBothReady(true)
            }

            if (isNewGame) {
              setJustMatched({ gameId: nextGameId, seconds: 3 })
              lastBannerGameIdRef.current = nextGameId
            }
          }
        })
        socket.on('players:bothReady', (data) => {
          console.log('[client] players:bothReady', data)
          setBothReady(true)
        })
      } catch (e) {
        console.error(e)
      }
    })()

    return () => {
      isMounted = false
      try { socketRef.current?.disconnect() } catch (_) {}
    }
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
            await fetch(`${API_ORIGIN}/api/v1/gameAction/ready`, {
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

  // When both players are ready, fetch the full masked game view for this player
  useEffect(() => {
    if (!bothReady) return
    if (!activeGame) return
    let aborted = false
    ;(async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/v1/games/getDetails`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId: activeGame.id, color: activeGame.color })
        })
        if (!res.ok) return
        const view = await res.json()
        if (aborted) return
        if (view && view.board) {
          setGame(g => ({
            ...g,
            board: view.board,
            stashes: view.stashes,
            onDecks: view.onDecks,
            daggers: view.daggers,
            captured: view.captured,
            actions: view.actions,
            moves: view.moves,
            playerTurn: view.playerTurn,
            onDeckingPlayer: view.onDeckingPlayer,
            isActive: view.isActive,
            winner: view.winner,
            winReason: view.winReason
          }))
        }
      } catch (_) {}
    })()
    return () => { aborted = true }
  }, [bothReady, activeGame])

  const lastAction = game.actions && game.actions.length > 0 ? game.actions[game.actions.length - 1] : null
  const lastMove = game.moves && game.moves.length > 0 ? game.moves[game.moves.length - 1] : null

  const isMyTurn = Boolean(activeGame && game?.isActive && game?.playerTurn === activeGame.color)

  const canChallenge = useMemo(() => {
    if (!isMyTurn || !lastAction) return false
    const myColor = activeGame.color
    if (lastAction.type === ACTIONS.MOVE) {
      if (!lastMove || lastMove.state !== MOVE_STATES.PENDING) return false
      return lastMove.player !== myColor
    }
    if (lastAction.type === ACTIONS.BOMB) {
      return lastAction.player !== myColor && lastAction.state === MOVE_STATES.PENDING
    }
    return false
  }, [isMyTurn, activeGame, lastAction, lastMove])

  const canBomb = useMemo(() => {
    if (!isMyTurn || !lastAction || !lastMove) return false
    const myColor = activeGame.color
    if (lastAction.type !== ACTIONS.MOVE) return false
    if (lastMove.player === myColor || lastMove.state !== MOVE_STATES.PENDING) return false
    const tgt = lastMove.to
    const pieceAtTarget = game.board?.[tgt.row]?.[tgt.col]
    return Boolean(pieceAtTarget && pieceAtTarget.color === myColor)
  }, [isMyTurn, activeGame, lastAction, lastMove, game.board])

  const handleChallenge = async () => {
    if (!activeGame) return
    try {
      await fetch(`${API_ORIGIN}/api/v1/gameAction/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: activeGame.id, color: activeGame.color })
      })
    } catch (e) {
      console.error('Challenge failed', e)
    }
  }

  const handleBomb = async () => {
    if (!activeGame) return
    try {
      await fetch(`${API_ORIGIN}/api/v1/gameAction/bomb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: activeGame.id, color: activeGame.color })
      })
    } catch (e) {
      console.error('Bomb failed', e)
    }
  }

  return (
    <div ref={viewportRef} className={styles.viewport}>
      <div ref={containerRef} className={styles.playArea} style={layout.cssVars}>
        <div className={styles.gameState} style={{ top: layout.positions.gameStateTop, height: layout.sizes.gameStateHeight }}>
          {/* Opponent bar (top) */}
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
          {/* Self bar (bottom) */}
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

      <PlayArea>
        <Board
          board={game.board}
          perspective={perspective}
          sizes={layout.sizes}
          positions={layout.positions}
          identityToImg={identityToImg}
        />
      </PlayArea>

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
        onChallenge={handleChallenge}
        onPass={() => {}}
        onBomb={handleBomb}
        canChallenge={canChallenge}
        canBomb={canBomb}
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

