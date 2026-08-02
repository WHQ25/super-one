/**
 * Production Host Action executor — dispatches claimed actions to the real
 * desktop SuperOne MCP tool surface.
 *
 * sessionId identity (Slice 1 / browser_snapshot):
 * The node session UUID is the browser-tab owner key in the renderer store
 * (`tabs[id].owner === sessionId`). `executeBrowserTool` does NOT require a
 * desktop SessionManager entry — only tab ownership. Miniapp / built-in tools
 * that call getSessionHost() are out of scope for this slice.
 *
 * Dynamic import keeps EnvironmentHost loadable in unit tests that only mock
 * electron partially (tool-surface pulls logger / BrowserWindow).
 */

import type { HostActionExecutor } from './remote-host-action-consumer'

export const desktopHostActionExecutor: HostActionExecutor = async (claimed, signal) => {
  if (signal.aborted) {
    return {
      outcome: 'failed',
      error: { code: 'aborted', message: 'host action aborted before execution' },
    }
  }

  const args =
    claimed.args && typeof claimed.args === 'object' && !Array.isArray(claimed.args)
      ? (claimed.args as Record<string, unknown>)
      : {}

  try {
    const { executeSuperoneMcpTool } = await import('../mcp/superone-mcp-tool-surface')
    const result = await executeSuperoneMcpTool(claimed.sessionId, claimed.toolName, args)
    if (signal.aborted) {
      // Late result after cancel — do not report success; consumer skips respond.
      return {
        outcome: 'failed',
        error: { code: 'aborted', message: 'host action aborted during execution' },
      }
    }
    const isError = Boolean((result as { isError?: boolean })?.isError)
    if (isError) {
      return { outcome: 'failed', error: result, result }
    }
    return { outcome: 'succeeded', result }
  } catch (err) {
    if (signal.aborted) {
      return {
        outcome: 'failed',
        error: { code: 'aborted', message: 'host action aborted during execution' },
      }
    }
    return {
      outcome: 'failed',
      error: {
        code: 'executor_error',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
