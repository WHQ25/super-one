import { create } from 'zustand'
import { McpAppsError } from '@superone/shared/mcp-apps'
import { mcpAppFileExtension, type McpAppFileHandler, type McpAppFileHandlersResult } from '@superone/shared/mcp-app-files'
import { useChatStore } from '@/stores/chat'
import type { SessionScope } from '@/stores/chat-store/session-scope'
import type { McpAppRoute } from './desktop-executor'

export type McpAppFileHandlersState =
  | { status: 'loading' }
  | { status: 'ready'; handlers: McpAppFileHandler[]; unavailable?: McpAppFileHandlersResult['unavailable'] }
  | { status: 'error' }

/** Entries stay usable after this; it only governs when an interaction refetches. */
const TTL_MS = 30_000
const fetchedAt = new Map<string, number>()
const cacheKey = (route: McpAppRoute, extension: string) => JSON.stringify([route.projectPath, route.sessionId, extension])

/** Handlers depend only on the session's servers and the extension, so one lookup serves every file of that type. */
export const useMcpAppFileHandlerCache = create<{ entries: Record<string, McpAppFileHandlersState> }>(() => ({ entries: {} }))

/**
 * The session an App opened from this pane belongs to. `null` is the unscoped main
 * chat; surfaces outside any pane (file tree, file preview) pass `lastTouchedPane()`.
 */
export function useMcpAppFileRoute(scope: SessionScope | null): McpAppRoute | null {
  const projectPath = useChatStore(state => scope ? null : state.activeProject)
  const sessionId = useChatStore(state => scope || !state.activeProject ? null : state.projectSessions[state.activeProject]?._activeSessionId ?? null)
  if (scope) return scope
  return projectPath && sessionId ? { projectPath, sessionId } : null
}

/** `passive` asks only a harness that is already running, and does not count as an answer for the TTL. */
export function prefetchMcpAppFileHandlers(route: McpAppRoute | null, filePath: string, options: { passive?: boolean } = {}): void {
  const extension = mcpAppFileExtension(filePath)
  if (!route || !extension) return
  const key = cacheKey(route, extension)
  const previous = fetchedAt.get(key)
  if (previous !== undefined && Date.now() - previous < TTL_MS) return
  fetchedAt.set(key, Date.now())
  const set = (value: McpAppFileHandlersState) => useMcpAppFileHandlerCache.setState(state => ({ entries: { ...state.entries, [key]: value } }))
  if (!useMcpAppFileHandlerCache.getState().entries[key]) set({ status: 'loading' })
  void window.environment.mcpAppFileHandlers(route.projectPath, route.sessionId, filePath, options).then(result => {
    if (result.ok) {
      if (result.value.incomplete || (options.passive && result.value.unavailable === 'no-session')) {
        // An idle harness or a server that did not answer says nothing final:
        // ask again on the next interaction and keep what an earlier lookup found.
        fetchedAt.delete(key)
        if (useMcpAppFileHandlerCache.getState().entries[key]?.status === 'ready') return
      }
      set({ status: 'ready', ...result.value })
      return
    }
    throw new Error(result.error.message)
  }).catch(() => {
    fetchedAt.delete(key)
    // Keep a previous answer rather than replacing it with a transient failure.
    if (useMcpAppFileHandlerCache.getState().entries[key]?.status !== 'ready') set({ status: 'error' })
  })
}

/**
 * Reads the cache only. Lookups start on interaction (`prefetchMcpAppFileHandlers`),
 * never on mount: asking may start the session's harness, and a transcript can
 * render many chips for sessions nobody is using.
 */
export function useMcpAppFileHandlers(route: McpAppRoute | null, filePath: string | null | undefined): McpAppFileHandlersState | undefined {
  const extension = filePath ? mcpAppFileExtension(filePath) : ''
  const key = route && extension ? cacheKey(route, extension) : ''
  return useMcpAppFileHandlerCache(state => key ? state.entries[key] : undefined)
}

/** Calls the App's file entrypoint and shows its View in an activity tab next to the file. */
export async function openFileWithMcpApp(route: McpAppRoute, handler: McpAppFileHandler, absolutePath: string): Promise<void> {
  const api = window.environment
  const result = await api.mcpAppOpenFile(route.projectPath, route.sessionId, { server: handler.server, tool: handler.tool, path: absolutePath })
  if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
  const app = result.value
  // The View host is loaded only when a file is actually opened, not by every chip that offers it.
  const { useMcpAppLayout } = await import('./layout-store')
  useMcpAppLayout.getState().openHost({
    app, route, api, title: handler.title, toolName: `mcp__${handler.server}__${handler.tool}`,
    onClose: () => { void api.mcpAppCloseFile(route.projectPath, route.sessionId, app.appInstanceId).catch(() => {}) },
  })
}
