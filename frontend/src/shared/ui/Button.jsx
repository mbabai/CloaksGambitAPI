import React from 'react'
import styles from './Button.module.css'

export default function Button({ className = '', style = {}, ...props }) {
  return <button className={`${styles.button} ${className}`} style={style} {...props} />
}
