export function calcLayout(dims, { rows, cols, stashRows, stashCols }) {
  const playAreaWidth = dims.width || 0
  const playAreaHeight = dims.height || 0

  const squareFromWidthLimit = playAreaWidth / (cols + 1)
  const squareFromHeightLimit = (0.6 * playAreaHeight) / rows
  const squareSize = Math.max(1, Math.floor(Math.min(squareFromWidthLimit, squareFromHeightLimit)))

  const boardWidth = squareSize * cols
  const boardHeight = squareSize * rows
  const boardLeft = (playAreaWidth - boardWidth) / 2
  const desiredCenterY = playAreaHeight * 0.40
  let boardTop = desiredCenterY - (boardHeight / 2)
  boardTop = Math.max(0, Math.min(playAreaHeight - boardHeight, boardTop))

  const stashTop = boardTop + boardHeight + 5
  const stashHeight = squareSize * (stashRows || 0)
  const buttonHeight = squareSize * 1.1
  const actionButtonsTop = boardTop + boardHeight + 10
  const gameStateHeight = squareSize * 1.9
  const gameStateTop = boardTop - gameStateHeight - 5

  const sizes = {
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

  const positions = {
    board: { left: boardLeft, top: boardTop },
    stash: { left: boardLeft, top: stashTop },
    actionButtons: { left: boardLeft, top: actionButtonsTop },
    gameStateTop,
    queuer: { left: boardLeft + boardWidth + (squareSize * 0.2), top: boardTop },
  }

  const base = Math.min(playAreaWidth, playAreaHeight)
  const ratios = {
    '--font-size-player-name': base * 0.056,
    '--font-size-player-clock': base * 0.070,
    '--font-size-dagger-token': base * 0.032,
    '--font-size-captured-piece': base * 0.042,
    '--font-size-board-square': base * 0.028,
    '--font-size-board-piece': base * 0.032,
    '--font-size-stash-slot': base * 0.028,
    '--font-size-stash-piece': base * 0.028,
    '--font-size-action-button': base * 0.038,
    '--font-size-notation': base * 0.020,
  }
  const cssVars = {}
  for (const [k, v] of Object.entries(ratios)) cssVars[k] = `${v}px`
  cssVars.width = `${playAreaWidth}px`
  cssVars.height = `${playAreaHeight}px`

  return { sizes, positions, cssVars }
}
