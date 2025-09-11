import React from 'react'
import styles from './OverlayCard.module.css'

export default function OverlayCard({ children }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>{children}</div>
    </div>
  )
}
