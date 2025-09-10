import React from 'react'

export default function ActionButtons({ sizes, positions, onChallenge, onPass, onBomb, canChallenge, canBomb }) {
  const wrapperStyle = {
    position: 'absolute',
    left: `${positions.actionButtons.left}px`,
    top: `${positions.actionButtons.top}px`,
    width: `${sizes.boardWidth}px`,
    height: `${sizes.buttonHeight}px`,
    display: 'flex',
    justifyContent: canChallenge ? 'space-between' : 'flex-end',
    background: 'transparent'
  }
  const buttonSize = { width: `${sizes.squareSize * 2.2}px`, height: `${sizes.buttonHeight}px` }
  const baseButtonStyle = {
    ...buttonSize,
    fontSize: 'calc(var(--font-size-action-button) * 1.5)',
    border: '2px solid #fbbf24',
    borderRadius: '4px',
    color: '#fff',
    fontWeight: 'bold',
    background: '#4815be',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  }
  return (
    <div className="action-buttons" style={wrapperStyle}>
      {canChallenge && (
        <button className="action-button challenge actionButton" style={{ ...baseButtonStyle }} onClick={onChallenge}>Challenge</button>
      )}
      <div style={{ position: 'relative' }}>
        <button className="action-button pass actionButton" style={{ ...baseButtonStyle }} onClick={onPass}>Pass</button>
        {canBomb && (
          <button className="action-button bomb actionButton" style={{ ...baseButtonStyle, position: 'absolute', right: 0, top: 0, background: '#850202' }} onClick={onBomb}>Bomb</button>
        )}
      </div>
    </div>
  )
}

