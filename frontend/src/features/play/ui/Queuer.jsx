import React, { useMemo } from 'react'
import Button from '../../../shared/ui/Button.jsx'

export default function Queuer({ sizes, positions, mode, isSearching, onToggleSearch, onChangeMode }) {
  const wrapperStyle = useMemo(() => ({
    position: 'absolute',
    left: `${positions.queuer.left}px`,
    top: `${positions.queuer.top}px`,
    width: `${sizes.squareSize * 3.4}px`,
    maxWidth: '50vw',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: `${sizes.squareSize * 0.15}px`,
    background: 'transparent'
  }), [positions, sizes])

  const baseButtonStyle = useMemo(() => ({
    height: `${sizes.buttonHeight}px`,
    border: '2px solid #ffffff',
    borderRadius: '18px',
    background: isSearching ? '#7c3aed' : '#5b21b6',
    color: '#ffffff',
    fontSize: 'calc(var(--font-size-action-button) * 1.5)',
    boxShadow: '0 2px 0 rgba(255,255,255,0.4) inset, 0 6px 16px rgba(0,0,0,0.25)'
  }), [sizes, isSearching])

  const selectWrapperStyle = useMemo(() => ({
    position: 'relative',
    height: `${sizes.buttonHeight * 0.9}px`,
    border: '2px solid #ffffff',
    borderRadius: '14px',
    background: '#5b21b6',
    display: 'flex',
    alignItems: 'center',
    width: '75%',
    alignSelf: 'center'
  }), [sizes])

  const selectStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 'calc(var(--font-size-action-button) * 1.1)',
    padding: '0 34px 0 14px',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    cursor: isSearching ? 'not-allowed' : 'pointer'
  }), [sizes, isSearching])

  const caretStyle = useMemo(() => ({
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#ffffff',
    pointerEvents: 'none',
    fontSize: 'calc(var(--font-size-action-button) * 1.1)'
  }), [])

  const handleToggleSearch = () => { if (onToggleSearch) onToggleSearch() }
  const handleChange = (e) => { if (onChangeMode) onChangeMode(e.target.value) }

  return (
    <div style={wrapperStyle}>
      <Button style={baseButtonStyle} onClick={handleToggleSearch}>
        {isSearching ? 'Searching...' : 'Find Game'}
      </Button>
      <div style={selectWrapperStyle}>
        <select style={selectStyle} value={mode} onChange={handleChange} disabled={isSearching}>
          <option value="quickplay">Quickplay</option>
          <option value="ranked">Ranked</option>
          <option value="custom">Custom</option>
          <option value="bots">Bots</option>
        </select>
        <div style={caretStyle}>▾</div>
      </div>
    </div>
  )
}
