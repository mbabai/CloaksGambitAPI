import React from 'react'
import { io } from 'socket.io-client'

export default function AdminDashboard() {
  const [metrics, setMetrics] = React.useState({ connectedUsers: 0, quickplayQueue: 0, rankedQueue: 0 })
  const socketRef = React.useRef(null)

  React.useEffect(() => {
    const baseUrl = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')
    socketRef.current = io(baseUrl + '/admin', {
      transports: ['websocket'],
    })

    const socket = socketRef.current
    socket.on('admin:metrics', (payload) => {
      setMetrics(payload)
    })

    return () => {
      socket.off('admin:metrics')
      socket.disconnect()
    }
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <h2>Admin Dashboard</h2>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetricCard label="Connected Users" value={metrics.connectedUsers} />
        <MetricCard label="Quickplay Queue" value={metrics.quickplayQueue} />
        <MetricCard label="Ranked Queue" value={metrics.rankedQueue} />
      </div>
    </div>
  )
}

function MetricCard({ label, value }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
      <div style={{ color: '#6b7280', fontSize: 14 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}


