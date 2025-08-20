import React from 'react'

// Staggered stash + on-deck layout (top row 5 with on-deck center, bottom row 4)
export default function Stash({ sizes, positions }) {
  const s = Math.floor(sizes.squareSize)
  const slot = Math.floor(0.8 * s)
  const space = Math.max(4, Math.floor(0.12 * slot))

  // Bottom player bar metrics (must match PlayerState.jsx)
  const nameBarH = Math.floor(s * 0.7)
  const rowH = Math.floor(s * 0.7)
  const barGap = 6
  const barHeight = nameBarH + rowH + barGap

  const boardBottom = Math.floor(positions.board.top + sizes.boardHeight)
  const yStart = boardBottom + barGap + barHeight + 20

  const containerHeight = (s /* tallest on-deck */) + space + slot

  // Compute board center to center rows
  const boardCenterX = Math.floor(positions.board.left + sizes.boardWidth / 2)

  // Top row layout with true widths to keep all gaps = space
  const widthsTop = [slot, slot, s, slot, slot]
  const topTotal = widthsTop.reduce((a, b) => a + b, 0) + (widthsTop.length - 1) * space
  let xCursorTop = Math.round(boardCenterX - topTotal / 2)

  const topRow = widthsTop.map((w, i) => {
    const isOnDeck = i === 2
    const left = xCursorTop
    xCursorTop += w + space
    const top = isOnDeck ? Math.round(yStart - (s - slot)) : yStart
    const width = isOnDeck ? s : slot
    const height = isOnDeck ? s : slot
    return (
      <div
        key={`top-${i}`}
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          boxSizing: 'border-box',
          border: '3px solid #DAA520',
          background: isOnDeck ? '#3d2e88' : 'transparent'
        }}
      />
    )
  })

  // Bottom row centered under board (4 slots)
  const bottomCols = 4
  const bottomTotal = bottomCols * slot + (bottomCols - 1) * space
  const xStartBottom = Math.round(boardCenterX - bottomTotal / 2)
  const yBottom = yStart + slot + space

  const bottomRow = Array.from({ length: bottomCols }).map((_, i) => (
    <div
      key={`bot-${i}`}
      style={{
        position: 'absolute',
        left: `${xStartBottom + i * (slot + space)}px`,
        top: `${yBottom}px`,
        width: `${slot}px`,
        height: `${slot}px`,
        boxSizing: 'border-box',
        border: '3px solid #DAA520',
        background: 'transparent'
      }}
    />
  ))

  return (
    <div
      style={{
        position: 'absolute',
        left: `${positions.board.left}px`,
        top: `${yStart - (s - slot)}px`,
        width: `${sizes.boardWidth}px`,
        height: `${containerHeight + (s - slot)}px`,
        pointerEvents: 'none' // visual only for now
      }}
    >
      {topRow}
      {bottomRow}
    </div>
  )
}

