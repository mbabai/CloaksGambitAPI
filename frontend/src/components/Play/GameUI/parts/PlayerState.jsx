import React, { useMemo } from 'react'

// New PlayerState bar positioned relative to the board (top or bottom)
export default function PlayerState({ position, playerName, playerColor, sizes, positions, identityToChar }) {
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
    width: `${sizes.squareSize * 1.6}px`,
    height: `${rowHeight}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-player-clock)',
    background: playerColor === 0 ? '#ffffff' : '#000000',
    color: playerColor === 0 ? '#000' : '#fff',
    fontWeight: 'bold',
    fontFamily: 'Courier New, monospace'
  }

  const daggerWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }

  const daggerToken = (i) => {
    const tokenSize = rowHeight * 0.8
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

  // For testing: show 4 captured pieces always
  const capturedPieces = useMemo(() => {
    const oppColor = playerColor === 0 ? 1 : 0
    const ids = [1, 3, 4, 5] // King, Bishop, Rook, Knight
    return ids.map(id => ({ color: oppColor, identity: id }))
  }, [playerColor])

  const capturedStrip = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {capturedPieces.map((p, i) => {
        const capSize = sizes.squareSize * 0.5
        return (
          <div
            key={i}
            style={{
              width: `${capSize}px`,
              height: `${capSize}px`,
              background: p.color === 1 ? '#000' : '#fff',
              border: '1px solid #000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--font-size-captured-piece)',
              color: p.color === 1 ? '#fff' : '#000',
              flexShrink: 0
            }}
          >
            {identityToChar?.[p.identity]}
          </div>
        )
      })}
    </div>
  )

  const rightCluster = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {!isTop && <></>}
      <div style={daggerWrapStyle}>{[0,1].map(daggerToken)}</div>
      <div style={clockBoxStyle}>{'5:00'}</div>
    </div>
  )

  const leftCluster = (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {capturedStrip}
    </div>
  )

  return (
    <div className={`player-bar ${isTop ? 'top' : 'bottom'}`} style={containerStyle}>
      <div style={nameStyle}>{name}</div>
      <div style={rowStyle}>
        {isTop ? (
          <>
            {leftCluster}
            {rightCluster}
          </>
        ) : (
          <>
            {leftCluster}
            {rightCluster}
          </>
        )}
      </div>
    </div>
  )
}

