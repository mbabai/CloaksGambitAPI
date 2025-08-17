import React from 'react'

export default function Stash({ stashes, sizes, positions, identityToChar }) {
  const gridStyle = {
    position: 'absolute',
    left: `${positions.stash.left}px`,
    top: `${positions.stash.top}px`,
    width: `${sizes.boardWidth}px`,
    height: `${sizes.stashHeight}px`,
    display: 'grid',
    gridTemplateColumns: `repeat(${stashes[0].length}, ${sizes.squareSize}px)`,
    gridTemplateRows: `repeat(${stashes.length}, ${sizes.squareSize}px)`
  }

  return (
    <div className="stash" style={gridStyle}>
      {stashes.map((row, r) => (
        row.map((cell, c) => {
          const isOnDeck = r === 0 && c === 2
          const slotStyle = {
            position: 'relative',
            width: `${sizes.squareSize}px`,
            height: `${sizes.squareSize}px`,
            background: isOnDeck ? '#8b5cf6' : 'transparent'
          }
          return (
            <div key={`${r}-${c}`} className={`stash-slot ${isOnDeck ? 'on-deck' : ''}`} style={slotStyle}>
              {cell && (
                <div className={`stash-piece ${cell && cell.color === 1 ? 'black' : ''}`} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '80%', height: '80%', background: cell && cell.color === 1 ? '#000' : '#fff', color: cell && cell.color === 1 ? '#fff' : '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-stash-piece)' }}>
                  {identityToChar[cell.identity]}
                </div>
              )}
            </div>
          )
        })
      ))}
    </div>
  )
}

