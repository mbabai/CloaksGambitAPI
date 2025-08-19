import React, { useMemo } from 'react'

export default function Board({ board, perspective, sizes, positions, identityToChar }) {
  const rows = board?.length || 6
  const cols = board?.[0]?.length || 5
  const isWhite = perspective === 'white'
  const gridStyle = useMemo(() => ({
    position: 'absolute',
    left: `${positions.board.left}px`,
    top: `${positions.board.top}px`,
    width: `${sizes.boardWidth}px`,
    height: `${sizes.boardHeight}px`,
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${sizes.squareSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${sizes.squareSize}px)`
  }), [positions.board.left, positions.board.top, sizes.boardWidth, sizes.boardHeight, sizes.squareSize, rows, cols])

  return (
    <div className="board" style={gridStyle}>
      {Array.from({ length: rows }).map((_, r) => (
        Array.from({ length: cols }).map((_, c) => {
          const light = isWhite ? ((r + c) % 2 === 1) : ((r + c) % 2 === 0)
          const squareStyle = {
            width: `${sizes.squareSize}px`,
            height: `${sizes.squareSize}px`,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--font-size-board-square)',
            fontWeight: 'bold',
            background: light ? '#f7f7f7' : '#6b7280',
            border: '1px solid #9ca3af'
          }
          const cell = board?.[r]?.[c]
          return (
            <div key={`${r}-${c}`} className={`board-square ${light ? 'light' : 'dark'}`} style={squareStyle}>
              {cell && (
                <div
                  className={`board-piece ${cell.color === 0 ? 'white' : 'black'}`}
                  style={{
                    width: '80%',
                    height: '80%',
                    background: cell.color === 0 ? '#fff' : '#000',
                    color: cell.color === 0 ? '#000' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--font-size-board-piece)'
                  }}
                >
                  {identityToChar?.[cell.identity]}
                </div>
              )}
            </div>
          )
        })
      ))}
    </div>
  )
}

