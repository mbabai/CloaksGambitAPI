import React from 'react'

export default function Board({ board, perspective, sizes, positions, identityToChar }) {
  const isWhite = perspective === 'white'
  const gridStyle = {
    position: 'absolute',
    left: `${positions.board.left}px`,
    top: `${positions.board.top}px`,
    width: `${sizes.boardWidth}px`,
    height: `${sizes.boardHeight}px`,
    display: 'grid',
    gridTemplateColumns: `repeat(${board[0].length}, ${sizes.squareSize}px)`,
    gridTemplateRows: `repeat(${board.length}, ${sizes.squareSize}px)`
  }

  return (
    <div className="board" style={gridStyle}>
      {board.map((row, r) => (
        row.map((cell, c) => {
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
            border: '1px solid #AAA',
            background: light ? '#FFF' : '#777'
          }

          return (
            <div key={`${r}-${c}`} className={`board-square ${light ? 'light' : 'dark'}`} style={squareStyle}>
              {c === 0 && (
                <div className="board-label row-label" style={{ position: 'absolute', top: '2px', left: '2px', fontSize: 'var(--font-size-board-square)', fontWeight: 'bold', color: '#333', zIndex: 1 }}>
                  {isWhite ? (board.length - r) : (r + 1)}
                </div>
              )}
              {r === board.length - 1 && (
                <div className="board-label col-label" style={{ position: 'absolute', bottom: '2px', right: '2px', fontSize: 'var(--font-size-board-square)', fontWeight: 'bold', color: '#333', zIndex: 1 }}>
                  {String.fromCharCode((isWhite ? 65 : 69) + (isWhite ? c : -c))}
                </div>
              )}
              {cell && (
                <div className={`board-piece ${cell.color === 0 ? 'white' : 'black'}`} style={{ width: '80%', height: '80%', background: cell.color === 0 ? '#fff' : '#000', color: cell.color === 0 ? '#000' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-board-piece)' }}>
                  {identityToChar[cell.identity]}
                </div>
              )}
              {c === 2 && r === 4 && (
                <>
                  <div className="bubble left thought-left visible" style={{ position: 'absolute', width: '100%', height: '100%', left: '-50%', top: '-45%', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', zIndex: 4, pointerEvents: 'none', backgroundImage: 'url(/assets/images/UI/BubbleSpeechLeftBishop.svg)' }} />
                  <div className="bubble right thought-right visible" style={{ position: 'absolute', width: '100%', height: '100%', right: '-50%', top: '-45%', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', zIndex: 4, pointerEvents: 'none', backgroundImage: 'url(/assets/images/UI/BubbleThoughtRightKing.svg)' }} />
                </>
              )}
            </div>
          )
        })
      ))}
    </div>
  )
}

