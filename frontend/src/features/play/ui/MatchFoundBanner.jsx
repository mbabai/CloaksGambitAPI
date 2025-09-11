import React from 'react'
import OverlayCard from '../../../shared/ui/OverlayCard.jsx'

export default function MatchFoundBanner({ seconds }) {
  return (
    <OverlayCard>
      <div style={styles.title}>Match Found</div>
      <div style={styles.count}>{seconds === 0 ? 'Go!' : seconds}</div>
    </OverlayCard>
  )
}

const styles = {
  title: {
    fontSize: 32,
    fontWeight: 800,
    marginBottom: 10,
    letterSpacing: 0.5
  },
  count: {
    fontSize: 80,
    fontWeight: 900,
    lineHeight: 1,
  }
}
