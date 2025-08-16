import React, { useMemo } from 'react'

export default function PlayerState({ side, perspective, daggers, captured, sizes, identityToChar }) {
  const isLeft = side === 'left'
  const name = useMemo(() => {
    if (perspective === 'white') return isLeft ? 'White' : 'Black'
    return isLeft ? 'Black' : 'White'
  }, [isLeft, perspective])

  const isLeftClockWhite = (perspective === 'white' && isLeft) || (perspective === 'black' && !isLeft)

  const daggerCountLeft = perspective === 'white' ? daggers[0] : daggers[1]
  const daggerCountRight = perspective === 'white' ? daggers[1] : daggers[0]
  const daggerCount = isLeft ? daggerCountLeft : daggerCountRight

  const capturedLeft = perspective === 'white' ? captured[1] : captured[0]
  const capturedRight = perspective === 'white' ? captured[0] : captured[1]
  const capturedList = isLeft ? capturedLeft : capturedRight

  const nameStyle = {
    position: 'absolute',
    top: `${sizes.squareSize * 0.66 * 0.15}px`,
    [isLeft ? 'left' : 'right']: '0px',
    width: `${sizes.squareSize * 3 - sizes.squareSize * 0.5 / 2}px`,
    height: `${sizes.squareSize * 0.66}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: isLeft ? 'flex-start' : 'flex-end',
    fontSize: 'var(--font-size-player-name)',
    color: '#fff'
  }

  const clockStyle = {
    position: 'absolute',
    top: `${sizes.squareSize * 0.66 + 0.5}px`,
    [isLeft ? 'left' : 'right']: '0px',
    width: `${sizes.squareSize * 1.4}px`,
    height: `${sizes.squareSize * 0.66}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-player-clock)',
    background: isLeftClockWhite ? '#ffffff' : '#000000',
    color: isLeftClockWhite ? '#000' : '#fff',
    fontWeight: 'bold',
    fontFamily: 'Courier New, monospace'
  }

  const daggerStyle = {
    position: 'absolute',
    top: `${sizes.squareSize * 0.66 + 0.5}px`,
    [isLeft ? 'left' : 'right']: `${sizes.squareSize * 1.4 + 2}px`,
    height: `${sizes.squareSize * 0.66}px`,
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px'
  }

  const capturesStyle = {
    position: 'absolute',
    bottom: '0px',
    [isLeft ? 'left' : 'right']: '0px',
    height: `${sizes.squareSize * 0.5}px`,
    display: 'flex',
    gap: '3px',
    justifyContent: isLeft ? 'flex-start' : 'flex-end',
    alignItems: 'center'
  }

  const containerStyle = {
    position: 'absolute',
    [isLeft ? 'left' : 'right']: `${Math.max(sizes.squareSize * 0.25, 10)}px`,
    width: `${(sizes.playAreaWidth - Math.max(sizes.squareSize * 0.25, 10) - 10) / 2}px`,
    height: `${sizes.gameStateHeight}px`
  }

  return (
    <div className={`player-state ${isLeft ? 'left' : 'right'}`} style={containerStyle}>
      <div className="player-name" style={nameStyle}>{name}</div>
      <div style={clockStyle}>{'5:00'}</div>
      <div className="dagger-space" style={daggerStyle}>
        {new Array(daggerCount).fill(0).map((_, i) => {
          const tokenSize = sizes.squareSize * 0.66 * 0.8
          return (
            <div
              key={i}
              className="dagger-token"
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
        })}
      </div>
      <div className={`captures-area ${isLeft ? '' : 'right'}`} style={capturesStyle}>
        {capturedList.map((p, i) => {
          const capSize = sizes.squareSize * 0.5
          return (
            <div
              key={i}
              className={`captured-piece ${p.color === 1 ? 'black' : ''}`}
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
              {identityToChar[p.identity]}
            </div>
          )
        })}
      </div>
    </div>
  )
}

