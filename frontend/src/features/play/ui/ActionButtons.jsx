import React from 'react'
import Button from '../../../shared/ui/Button.jsx'

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
  const buttonStyle = { width: `${sizes.squareSize * 2.2}px`, height: `${sizes.buttonHeight}px` }
  return (
    <div className="action-buttons" style={wrapperStyle}>
      {canChallenge && (
        <Button style={buttonStyle} onClick={onChallenge}>Challenge</Button>
      )}
      <div style={{ position: 'relative' }}>
        <Button style={buttonStyle} onClick={onPass}>Pass</Button>
        {canBomb && (
          <Button className="bomb" style={{ ...buttonStyle, position: 'absolute', right: 0, top: 0 }} onClick={onBomb}>Bomb</Button>
        )}
      </div>
    </div>
  )
}
