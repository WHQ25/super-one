import { useCallback, useEffect, useRef, useState } from 'react'

/** Isolate card refreshes and discard results from an old login or page. */
export function useProviderAccountMeters<T extends object>() {
  const [meters, setMeters] = useState<Record<string, T & { loading?: boolean; error?: boolean }>>({})
  const identities = useRef<Record<string, string>>({})
  const requests = useRef<Record<string, number>>({})
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++ }
  }, [])
  const sync = useCallback((accounts: Array<{ key: string; identity: string }>) => {
    generation.current++
    const previous = identities.current
    identities.current = Object.fromEntries(accounts.map((a) => [a.key, a.identity]))
    requests.current = {}
    setMeters((old) => Object.fromEntries(accounts.map((a) => [a.key,
      previous[a.key] === a.identity ? old[a.key] ?? {} : {},
    ])) as Record<string, T & { loading?: boolean; error?: boolean }>)
  }, [])
  const load = useCallback(async (key: string, read: () => Promise<T>) => {
    if (!(key in identities.current)) return
    const current = generation.current
    const request = requests.current[key] = (requests.current[key] ?? 0) + 1
    const active = () => mounted.current && current === generation.current && request === requests.current[key]
    setMeters((old) => ({ ...old, [key]: { ...old[key], loading: true } }))
    try {
      const next = await read()
      if (active()) setMeters((old) => ({ ...old, [key]: { ...old[key], ...next, loading: false } }))
    } catch {
      if (active()) setMeters((old) => ({ ...old, [key]: { ...old[key], loading: false, error: true } }))
    }
  }, [])
  return { meters, sync, load }
}
