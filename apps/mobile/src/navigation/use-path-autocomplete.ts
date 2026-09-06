import { useEffect, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import type { RemoteDirectoryEntry } from '../shell-state'
import { randomId } from '../ids'

/** Split a partly typed path into the folder to list and the prefix to filter by. */
export function splitTypedPath(value: string): { parent: string; prefix: string } {
  const slashed = value.replace(/\\/g, '/')
  const slash = slashed.lastIndexOf('/')
  if (slash === -1) return { parent: '', prefix: slashed }
  const parent = slashed.slice(0, slash) || '/'
  return { parent, prefix: slashed.slice(slash + 1) }
}

/** Replace the trailing segment with `name`, leaving the caret past a new separator. */
export function completeTypedPath(value: string, name: string): string {
  const slashed = value.replace(/\\/g, '/')
  const slash = slashed.lastIndexOf('/')
  const head = slash === -1 ? '' : slashed.slice(0, slash + 1)
  return `${head}${name}/`
}

/**
 * Folder completions for a typed path.
 *
 * The parent listing is cached, so typing further into the same folder filters
 * locally instead of re-asking the desktop on every keystroke — over a relay that
 * is the difference between a usable path field and a stutter.
 */
export function usePathAutocomplete(clientRef: RefObject<RelayClient | null>, value: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<RemoteDirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const cache = useRef<{ parent: string; entries: RemoteDirectoryEntry[] } | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const { parent, prefix } = splitTypedPath(value)
    const filter = (entries: RemoteDirectoryEntry[]) => entries
      .filter((entry) => entry.isDirectory && entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    if (!parent) { setSuggestions([]); return }
    if (cache.current?.parent === parent) { setSuggestions(filter(cache.current.entries)); return }
    const client = clientRef.current
    if (!client) return
    const request = ++generation.current
    setLoading(true)
    void client.request({ type: 'list_directory', requestId: randomId(), path: parent, showHidden: true } as RemoteCommand)
      .then((response) => {
        if (request !== generation.current) return
        const entries = (response as { items?: RemoteDirectoryEntry[] }).items ?? []
        cache.current = { parent, entries }
        setSuggestions(filter(entries))
      })
      .catch(() => { if (request === generation.current) setSuggestions([]) })
      .finally(() => { if (request === generation.current) setLoading(false) })
  }, [clientRef, enabled, value])

  const reset = () => { generation.current++; cache.current = null; setSuggestions([]); setLoading(false) }
  return { suggestions, loading, reset }
}
