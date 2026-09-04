import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

/** Flutter parity: immediately replace/recover the socket whenever the app resumes. */
export function useReconnectOnForeground(reconnect: () => void): void {
  const reconnectRef = useRef(reconnect)
  reconnectRef.current = reconnect

  useEffect(() => {
    let previous = AppState.currentState
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') reconnectRef.current()
      previous = next
    })
    return () => subscription.remove()
  }, [])
}
