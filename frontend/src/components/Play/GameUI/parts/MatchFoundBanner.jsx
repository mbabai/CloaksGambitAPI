import React from 'react'

export default function MatchFoundBanner({ seconds }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.title}>Match Found</div>
        <div style={styles.count}>{seconds === 0 ? 'Go!' : seconds}</div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    pointerEvents: 'none'
  },
  card: {
    pointerEvents: 'auto',
    width: '100%',
    maxWidth: '100%',
    height: 160,
    padding: '18px 26px',
    borderRadius: 0,
    borderTop: '2px solid #fbbf24',
    borderBottom: '2px solid #fbbf24',
    background: '#4c1d95',
    color: '#ffffff',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
    textAlign: 'center'
  },
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


