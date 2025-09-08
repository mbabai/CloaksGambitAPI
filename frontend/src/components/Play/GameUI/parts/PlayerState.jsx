import React, { useMemo } from 'react'
import Piece from './Piece.jsx'

// New PlayerState bar positioned relative to the board (top or bottom)
export default function PlayerState({ position, playerName, playerColor, sizes, positions, identityToImg, daggerCount = 0, capturedPieces = [] }) {
  const isTop = position === 'top'
  const isSelf = position === 'bottom'
  const name = playerName || (playerColor === 0 ? 'White' : 'Black')

  // Container spans board width and sits above or below the board
  const nameBarHeight = sizes.squareSize * 0.7
  const rowHeight = sizes.squareSize * 0.7
  const containerHeight = nameBarHeight + rowHeight + 6
  const containerTop = isTop
    ? Math.max(0, positions.board.top - containerHeight - 6)
    : positions.board.top + sizes.boardHeight + 6

  const containerStyle = {
    position: 'absolute',
    left: `${positions.board.left}px`,
    top: `${containerTop}px`,
    width: `${sizes.boardWidth}px`,
    height: `${containerHeight}px`,
  }

  const nameStyle = {
    height: `${nameBarHeight}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: isTop ? 'flex-end' : 'flex-start',
    fontSize: 'var(--font-size-player-name)',
    color: '#fff'
  }

  // Second row layout: captures | daggers + clock (bottom), inverted for top
  const rowStyle = {
    height: `${rowHeight}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px'
  }

  const clockBoxStyle = {
    width: `${2.9 * (sizes.squareSize * 0.7) }px`,
    height: `${rowHeight}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-player-clock)',
    background: playerColor === 0 ? '#ffffff' : '#000000',
    color: playerColor === 0 ? '#000' : '#fff',
    fontWeight: 'bold',
    fontFamily: 'Courier New, monospace',
    border: '2px solid #DAA520'
  }

  const daggerWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }

  const daggerToken = (i) => {
    const tokenSize = rowHeight
    return (
      <div
        key={i}
        style={{
          width: `${tokenSize}px`,
          height: `${tokenSize}px`,
          background: '#dc2626',
          border: '2px solid #ffffff',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 'var(--font-size-dagger-token)',
          fontWeight: 'bold',
          flexShrink: 0
        }}
      >
        ⚔
      </div>
    )
  }

  // Render provided capturedPieces as images
  const capturedToShow = useMemo(() => Array.isArray(capturedPieces) ? capturedPieces : [], [capturedPieces])

  const capturedStrip = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {capturedToShow.map((p, i) => {
        const capSize = sizes.squareSize * 0.365
        return (
          <div
            key={i}
            style={{
              width: `${capSize}px`,
              height: `${capSize}px`,
              border: '1px solid #000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Piece
              identity={p.identity}
              color={p.color}
              identityToImg={identityToImg}
            />
          </div>
        )
      })}
    </div>
  )

  const rightClusterTop = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={daggerWrapStyle}>{Array.from({ length: Math.max(0, daggerCount) }).map((_, i) => daggerToken(i))}</div>
      <div style={clockBoxStyle}>{'5:00'}</div>
    </div>
  )

  const leftClusterBottom = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={clockBoxStyle}>{'5:00'}</div>
      <div style={daggerWrapStyle}>{Array.from({ length: Math.max(0, daggerCount) }).map((_, i) => daggerToken(i))}</div>
    </div>
  )

  const leftCluster = (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {capturedStrip}
    </div>
  )

  return (
    <div className={`player-bar ${isTop ? 'top' : 'bottom'}`} style={containerStyle}>
      {isTop && <div style={nameStyle}>{name}</div>}
      <div style={rowStyle}>
        {isTop ? (
          <>
            {leftCluster}
            {rightClusterTop}
          </>
        ) : (
          <>
            {leftClusterBottom}
            {leftCluster}
          </>
        )}
      </div>
      {!isTop && <div style={nameStyle}>{name}</div>}
    </div>
  )
}

