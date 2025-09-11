import React from 'react'
const SOURCES = {
  top: '/assets/images/UI/BubbleSpeechTopChallenge.svg',
  bottom: '/assets/images/UI/BubbleSpeechBottomChallenge.svg',
}
/**
 * Simple speech bubble that overlays a player's name. Parent element should be
 * positioned relative.
 */
export default function ChallengeBubble({ position = 'top', sizes }) {
  const bubbleSize = sizes.squareSize * 1.5
  const style = {
    position: 'absolute',
    width: `${bubbleSize}px`,
    height: `${bubbleSize}px`,
    left: '50%',
    transform: 'translateX(-50%)',
    top: position === 'top' ? `-${bubbleSize * 0.9}px` : `calc(100% - ${bubbleSize * 0.1}px)`,
    zIndex: 20,
    pointerEvents: 'none',
  }
  const src = position === 'top' ? SOURCES.top : SOURCES.bottom
  return <img src={src} style={style} alt='challenge bubble' />
}