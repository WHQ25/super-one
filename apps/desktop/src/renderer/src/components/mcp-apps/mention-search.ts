import { useEffect, useRef, useState } from 'react'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import type { McpMentionSource } from '@superone/shared/mcp-app-mentions'
import type { McpAppRoute } from './desktop-executor'

export interface McpMentionSearchState {
  /** One section per server tool. While a query is in flight they keep the previous items. */
  sources: McpMentionSource[]
  loading: boolean
  /** Some server did not answer; more may appear on a later keystroke. */
  incomplete: boolean
  /** The lookup itself failed (no per-server answer). */
  failed: boolean
}

const IDLE: McpMentionSearchState = { sources: [], loading: false, incomplete: false, failed: false }

/**
 * Sections the last answer for a session had, without items. A new popup shows
 * them as loading at once instead of popping them in when the first answer lands.
 */
const knownSources = new Map<string, McpMentionSource[]>()
const routeKey = (route: McpAppRoute) => JSON.stringify([route.projectPath, route.sessionId])

/** Debounced `mentions/search` across the session's servers; the newest query wins. */
export function useMcpMentionSearch(route: McpAppRoute | null, query: string, enabled: boolean): McpMentionSearchState {
  const key = route && enabled ? routeKey(route) : ''
  const [state, setState] = useState<McpMentionSearchState>(IDLE)
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    if (!key || !route) {
      setState(IDLE)
      return
    }
    setState(previous => ({
      sources: previous.sources.length ? previous.sources : (knownSources.get(key) ?? []).map(source => ({ ...source, items: [] })),
      loading: true, incomplete: false, failed: false,
    }))
    const timer = setTimeout(() => {
      void window.environment.mcpAppMentionSearch(route.projectPath, route.sessionId, query).then(result => {
        if (gen !== generation.current) return
        if (!result.ok) throw new Error(result.error.message)
        const { sources, incomplete } = result.value
        // Only a complete answer says which servers search; an incomplete one may be missing some.
        if (!incomplete) knownSources.set(key, sources.map(source => ({ ...source, items: [] })))
        setState({ sources, loading: false, incomplete: !!incomplete, failed: false })
      }).catch(() => {
        if (gen !== generation.current) return
        setState(previous => ({ sources: previous.sources.map(source => ({ ...source, items: [] })), loading: false, incomplete: false, failed: true }))
      })
    }, MENTION_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `route` is read through `key`; a new object for the same session must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query])

  return state
}
