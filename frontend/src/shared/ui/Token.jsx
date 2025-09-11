import React from 'react'
import styles from './Token.module.css'

export default function Token({ children, style = {}, ...props }) {
  return (
    <div className={styles.token} style={style} {...props}>
      {children}
    </div>
  )
}
