import { useEffect, useMemo, useState } from 'react'

const TARGET_RATIO = 17 / 10

export function usePlayAreaLayout(ref, { rows, cols, stashRows, stashCols }) {
  const [container, setContainer] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const update = () => {
      const el = ref.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setContainer({ width: rect.width, height: rect.height })
      } else {
        setContainer({ width: window.innerWidth, height: window.innerHeight })
      }
    }
    update()
    const ro = ref.current ? new ResizeObserver(update) : null
    if (ref.current && ro) ro.observe(ref.current)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      if (ro && ref.current) ro.disconnect()
    }
  }, [ref])

  const sizes = useMemo(() => {
    const pageWidth = container.width || window.innerWidth
    const pageHeight = container.height || window.innerHeight

    // Play area maintains 17:10 visually, but we size the board within it
    const pageRatio = pageHeight / pageWidth
    const idealRatio = 1.7
    let playAreaWidth, playAreaHeight
    if (pageRatio >= idealRatio) {
      playAreaWidth = pageWidth
      playAreaHeight = pageWidth * idealRatio
    } else {
      playAreaHeight = pageHeight
      playAreaWidth = pageHeight / idealRatio
    }

    // Board sizing rules:
    // - Squares are 1:1; edge length S is min of:
    //   S <= playAreaWidth / (cols + 1)   (half-square margin on both sides)
    //   S <= (0.6 * playAreaHeight) / rows (board <= 60% of play area height)
    const squareFromWidthLimit = playAreaWidth / (cols + 1)
    const squareFromHeightLimit = (0.6 * playAreaHeight) / rows
    const squareSize = Math.max(1, Math.floor(Math.min(squareFromWidthLimit, squareFromHeightLimit)))

    const boardWidth = squareSize * cols
    const boardHeight = squareSize * rows
    const boardLeft = (playAreaWidth - boardWidth) / 2
    const boardTop = (playAreaHeight - boardHeight) / 2

    // Placeholder values for other UI sections (stash/actions) until specified
    const stashTop = boardTop + boardHeight + 5
    const stashHeight = squareSize * (stashRows || 0)
    const buttonHeight = squareSize * 1.1
    const actionButtonsTop = boardTop + boardHeight + 10
    const gameStateHeight = squareSize * 1.9
    const gameStateTop = boardTop - gameStateHeight - 5

    return {
      playAreaWidth,
      playAreaHeight,
      squareSize,
      boardWidth,
      boardHeight,
      boardLeft,
      boardTop,
      stashTop,
      stashHeight,
      actionButtonsTop,
      buttonHeight,
      gameStateHeight,
      gameStateTop,
    }
  }, [container, rows, cols, stashRows])

  const positions = useMemo(() => ({
    board: { left: sizes.boardLeft, top: sizes.boardTop },
    stash: { left: sizes.boardLeft, top: sizes.stashTop },
    actionButtons: { left: sizes.boardLeft, top: sizes.actionButtonsTop },
    gameStateTop: sizes.gameStateTop,
    queuer: { left: sizes.boardLeft + sizes.boardWidth + (sizes.squareSize * 0.2), top: sizes.boardTop },
  }), [sizes])

  const cssVars = useMemo(() => {
    const base = Math.min(sizes.playAreaWidth, sizes.playAreaHeight)
    const ratios = {
      '--font-size-player-name': base * 0.056,
      '--font-size-player-clock': base * 0.070,
      '--font-size-dagger-token': base * 0.032,
      '--font-size-captured-piece': base * 0.042,
      '--font-size-board-square': base * 0.028,
      '--font-size-board-piece': base * 0.032,
      '--font-size-stash-slot': base * 0.028,
      '--font-size-stash-piece': base * 0.028,
      '--font-size-action-button': base * 0.038
    }
    const style = {}
    for (const [k, v] of Object.entries(ratios)) style[k] = `${v}px`
    style.width = `${sizes.playAreaWidth}px`
    style.height = `${sizes.playAreaHeight}px`
    return style
  }, [sizes])

  return { sizes, positions, cssVars }
}

