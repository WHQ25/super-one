import { useEffect, useState } from 'react'

export interface RemoteStatus {
  hostname: string
  relayConnected: boolean
  lanActive: boolean
}

export function useRemoteStatus(enabled = true): RemoteStatus {
  const [hostname, setHostname] = useState('')
  const [relayConnected, setRelayConnected] = useState(false)
  const [lanActive, setLanActive] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setRelayConnected(false)
      setLanActive(false)
      return
    }
    let cancelled = false
    window.app.getHostname().then((name) => {
      if (!cancelled) setHostname(name)
    })
    window.app.getRelayStatus().then((connected) => {
      if (!cancelled) setRelayConnected(connected)
    })
    window.app.getLanStatus().then((active) => {
      if (!cancelled) setLanActive(active)
    })
    const unsubRelay = window.app.onRelayStatusChanged(setRelayConnected)
    const unsubLan = window.app.onLanStatusChanged(setLanActive)
    return () => {
      cancelled = true
      unsubRelay()
      unsubLan()
    }
  }, [enabled])

  return { hostname, relayConnected, lanActive }
}
