import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { Game, Lobby, Users, getApiOrigin } from '../api/client.js'

const sampleGameState = {
  board: Array(6).fill(null).map(() => Array(5).fill(null)),
  stashes: [Array(5).fill(null), Array(5).fill(null)],
  daggers: [0, 0],
  captured: [[], []],
  onDecks: [null, null]
}

export function useGameClient() {
  const [perspective, setPerspective] = useState('white')
  const [game, setGame] = useState(sampleGameState)
  const [mode, setMode] = useState('quickplay')
  const [isQueuedServer, setIsQueuedServer] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [justMatched, setJustMatched] = useState(null)
  const socketRef = useRef(null)
  const lastBannerGameIdRef = useRef(null)
  const [bothReady, setBothReady] = useState(false)

  const API_ORIGIN = getApiOrigin()

  useEffect(() => {
    let isMounted = true
    async function ensureUserId() {
      const match = document.cookie.match(/(?:^|; )userId=([^;]+)/)
      if (match) return decodeURIComponent(match[1])
      const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const username = 'guest_' + nonce
      const email = nonce + '@guest.local'
      const res = await Users.createGuest(username, email)
      if (!res.ok) throw new Error('Failed to create guest user')
      const user = await res.json()
      const id = user && user._id
      document.cookie = `userId=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`
      return id
    }
    ;(async () => {
      try {
        const userId = await ensureUserId()
        if (!isMounted) return
        const socket = io(API_ORIGIN, { auth: { userId } })
        socketRef.current = socket
        socket.on('initialState', ({ queued, games }) => {
          setIsQueuedServer(Boolean(queued?.quickplay))
          setPendingAction(null)
          if (Array.isArray(games) && games.length > 0) {
            const g = games[0]
            const existingId = g.gameId || g._id
            const colorIdx = g.players?.findIndex?.(p => p === userId) ?? 0
            setActiveGame({ id: existingId, color: colorIdx })
            setPerspective(colorIdx === 0 ? 'white' : 'black')
            lastBannerGameIdRef.current = existingId
            setBothReady(Boolean(g?.playersReady?.[0] && g?.playersReady?.[1]))
            const isReady = Array.isArray(g?.playersReady) ? Boolean(g.playersReady[colorIdx]) : false
            if (!isReady) {
              await Game.ready(existingId, colorIdx)
            }
          }
        })
        socket.on('queue:update', (payload) => {
          setIsQueuedServer(Boolean(payload?.quickplay))
          setPendingAction(null)
        })
        socket.on('game:update', (payload) => {
          if (payload && payload.board) {
            const colorIdx = payload.players?.findIndex?.(p => p === userId) ?? 0
            const nextGameId = payload.gameId
            const isNewGame = lastBannerGameIdRef.current !== nextGameId
            setActiveGame({ id: nextGameId, color: colorIdx })
            setPerspective(colorIdx === 0 ? 'white' : 'black')
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
        socket.on('players:bothReady', () => setBothReady(true))
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      isMounted = false
      try { socketRef.current?.disconnect() } catch (_) {}
    }
  }, [API_ORIGIN])

  useEffect(() => {
    if (!justMatched || !activeGame || justMatched.gameId !== activeGame.id) return
    if (justMatched.seconds <= 0) {
      setJustMatched(null)
      return
    }
    const timer = setTimeout(async () => {
      const next = justMatched.seconds - 1
      if (next === 0) {
        try {
          await Game.ready(activeGame.id, activeGame.color)
        } catch (e) {
          console.error('Failed to send READY:', e)
        }
      }
      setJustMatched({ ...justMatched, seconds: next })
    }, 1000)
    return () => clearTimeout(timer)
  }, [justMatched, activeGame])

  useEffect(() => {
    if (!bothReady || !activeGame) return
    let aborted = false
    ;(async () => {
      try {
        const res = await Game.getDetails(activeGame.id, activeGame.color)
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
            winReason: view.winReason,
          }))
        }
      } catch (_) {}
    })()
    return () => { aborted = true }
  }, [bothReady, activeGame])

  const toggleQueue = async () => {
    try {
      const userId = document.cookie.match(/(?:^|; )userId=([^;]+)/)?.[1]
      if (!userId) return
      const leaving = (pendingAction === 'join' || isQueuedServer)
      const api = leaving ? Lobby.exitQuickplay : Lobby.enterQuickplay
      setPendingAction(leaving ? 'leave' : 'join')
      const res = await api(decodeURIComponent(userId))
      if (!res.ok) {
        setPendingAction(null)
      }
    } catch (e) {
      console.error(e)
      setPendingAction(null)
    }
  }

  const send = {
    ready: async () => {
      if (!activeGame) return
      try { await Game.ready(activeGame.id, activeGame.color) } catch (e) { console.error(e) }
    },
    challenge: async () => {
      if (!activeGame) return
      try { await Game.challenge(activeGame.id, activeGame.color) } catch (e) { console.error('Challenge failed', e) }
    },
    bomb: async () => {
      if (!activeGame) return
      try { await Game.bomb(activeGame.id, activeGame.color) } catch (e) { console.error('Bomb failed', e) }
    },
  }

  return { state: { game, perspective, mode, isQueuedServer, pendingAction, activeGame, justMatched }, send, queue: { toggle: toggleQueue, setMode, mode } }
}
