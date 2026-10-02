import type { RelayClient } from '@superone/relay-client'
import {
  MCP_MENTION_SEARCH_IDLE, mcpMentionSearchAnswered, mcpMentionSearchFailed, mcpMentionSearchStarted, type McpMentionSearchState,
} from '@superone/shared/mcp-app-mentions'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { requestMcpMentionSearch } from '../mention-search'

/**
 * The desktop popup's `mentions/search` across the session's MCP servers: debounced,
 * newest query wins. `query` is null while server items do not apply (no `@`, a
 * portal, a folder being browsed); there is nothing to ask before a session exists.
 */
export function useMcpMentionSearch(
  client: RefObject<RelayClient | null>,
  projectPath: string | undefined,
  sessionId: string | null | undefined,
  query: string | null,
): McpMentionSearchState {
  const key = projectPath && sessionId && query !== null ? JSON.stringify([projectPath, sessionId]) : ''
  const [state, setState] = useState<McpMentionSearchState>(MCP_MENTION_SEARCH_IDLE)
  const generation = useRef(0)

  useEffect(() => {
    const request = ++generation.current
    const relay = client.current
    if (!key || !relay || !projectPath || !sessionId || query === null) {
      setState(MCP_MENTION_SEARCH_IDLE)
      return
    }
    setState((previous) => mcpMentionSearchStarted(key, previous))
    const timer = setTimeout(() => {
      void requestMcpMentionSearch(relay, projectPath, sessionId, query).then((result) => {
        if (request === generation.current) setState(mcpMentionSearchAnswered(key, result))
      }).catch(() => {
        if (request === generation.current) setState(mcpMentionSearchFailed)
      })
    }, MENTION_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `projectPath` and `sessionId` are read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query])

  return state
}
