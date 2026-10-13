import type { TurnRunner } from '@superone/runtime/session'
import { startOpenCodeServer } from './server'
import { runOpenCodeV1Turn } from './run-turn-v1'

export interface RunOpenCodeTurnOptions {
  binaryPath?: string | null
  serverUrl?: string | null
  serverPassword?: string | null
  env?: Record<string, string>
  startupTimeoutMs?: number
  serviceHome?: string
  mapModel?: (selected?: string | null) => string | undefined
  providerModels?: import('@superone/shared/agent-types').ModelOption[]
  /**
   * SuperOne Host Action HTTP MCP (or equivalent remote MCP).
   * Registered via `client.mcp.add` before the prompt.
   */
  superoneMcp?: {
    url: string
    headers: Record<string, string>
  } | null
  /** Per-session override when URL/token depends on SuperOne session id. */
  getSuperoneMcp?: (sessionId: string) => { url: string; headers: Record<string, string> } | null | undefined
}

/** Per-turn private server ownership; the provider session id survives process restarts. */
export function createOpenCodeAppServerTurnRunner(
  resolveProjectPath: (projectId: string) => string | null,
  opts: RunOpenCodeTurnOptions = {},
): TurnRunner {
  return async (input) => {
    const projectRoot = resolveProjectPath(input.session.projectId) || process.env.SUPERONE_DEFAULT_CWD || process.cwd()
    const cwd = input.session.cwd?.trim() || projectRoot
    const server = await startOpenCodeServer({
      ...opts,
      cwd,
      timeoutMs: opts.startupTimeoutMs,
      signal: input.signal,
    })
    try {
      if (server.protocol === 'v2') {
        const { runOpenCodeV2Turn } = await import('./run-turn-v2')
        return await runOpenCodeV2Turn(input, server, cwd, opts)
      }
      return await runOpenCodeV1Turn(input, server, cwd, opts)
    } finally {
      await server.close().catch(() => {})
    }
  }
}
