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

  const fileLetters = ['A','B','C','D','E']

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

          // Notation
          const showFile = r === rows - 1
          const showRank = c === 0
          const fileIndex = isWhite ? c : cols - 1 - c
          const rankIndex = isWhite ? r : rows - 1 - r
          const file = fileLetters[fileIndex] || ''
          const rank = String(rankIndex + 1)

          const notationStyleBase = {
            position: 'absolute',
            color: '#000',
            fontSize: 'var(--font-size-notation)',
            fontWeight: 400,
            opacity: 0.9,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', 'Nimbus Sans', 'DejaVu Sans', serif",
            lineHeight: 1,
            userSelect: 'none',
            pointerEvents: 'none',
          }

          const fileStyle = {
            ...notationStyleBase,
            right: '3px',
            bottom: '2px'
          }

          const rankStyle = {
            ...notationStyleBase,
            left: '3px',
            top: '2px'
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
              {showFile && (
                <span style={fileStyle}>{file}</span>
              )}
              {showRank && (
                <span style={rankStyle}>{rank}</span>
              )}
            </div>
          )
        })
      ))}
    </div>
  )
}

