import { useEffect, useState } from 'react'
import { loadEnvironmentItems, subscribeEnvironmentList } from '@/lib/environment-list'

/** A paired computer's name, read once it is needed; null until known. */
export function useEnvironmentLabel(connectionId: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    const read = () => {
      void loadEnvironmentItems()
        .then((items) => { if (!cancelled) setLabel(items.find((item) => item.connectionId === connectionId)?.label ?? null) })
        .catch(() => {})
    }
    read()
    const unsubscribe = subscribeEnvironmentList(read)
    return () => { cancelled = true; unsubscribe() }
  }, [connectionId])
  return connectionId ? label : null
}
