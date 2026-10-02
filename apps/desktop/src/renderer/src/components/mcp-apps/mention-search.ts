import { useEffect, useRef, useState } from 'react'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import {
  MCP_MENTION_SEARCH_IDLE, mcpMentionSearchAnswered, mcpMentionSearchFailed, mcpMentionSearchStarted, type McpMentionSearchState,
} from '@superone/shared/mcp-app-mentions'
import type { McpAppRoute } from './desktop-executor'
import { rememberMcpMentionIcons } from './mention-icons'

const routeKey = (route: McpAppRoute) => JSON.stringify([route.projectPath, route.sessionId])

/** Debounced `mentions/search` across the session's servers; the newest query wins. */
export function useMcpMentionSearch(route: McpAppRoute | null, query: string, enabled: boolean): McpMentionSearchState {
  const key = route && enabled ? routeKey(route) : ''
  const [state, setState] = useState<McpMentionSearchState>(MCP_MENTION_SEARCH_IDLE)
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    if (!key || !route) {
      setState(MCP_MENTION_SEARCH_IDLE)
      return
    }
    setState(previous => mcpMentionSearchStarted(key, previous))
    const timer = setTimeout(() => {
      void window.environment.mcpAppMentionSearch(route.projectPath, route.sessionId, query).then(result => {
        if (gen !== generation.current) return
        if (!result.ok) throw new Error(result.error.message)
        rememberMcpMentionIcons(result.value.sources)
        setState(mcpMentionSearchAnswered(key, result.value))
      }).catch(() => {
        if (gen !== generation.current) return
        setState(mcpMentionSearchFailed)
      })
    }, MENTION_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `route` is read through `key`; a new object for the same session must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query])

  return state
}
