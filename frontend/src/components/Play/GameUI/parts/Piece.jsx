import React from 'react'

export default function Piece({ identity, color, identityToImg, style = {} }) {
  const src = identityToImg?.[identity]?.[color]
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }}
    />
  )
}
