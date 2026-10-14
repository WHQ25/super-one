import { useEffect, useState } from 'react'

/** A paired computer's name, read once it is needed; null until known. */
export function useEnvironmentLabel(connectionId: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    void window.environment.listItems()
      .then((items) => { if (!cancelled) setLabel(items.find((item) => item.connectionId === connectionId)?.label ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [connectionId])
  return connectionId ? label : null
}
