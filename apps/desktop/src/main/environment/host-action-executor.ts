/**
 * Production Host Action executor — dispatches claimed actions to the real
 * desktop SuperOne MCP tool surface (`executeSuperoneMcpTool`).
 *
 * sessionId identity:
 * - Browser / Computer Use / miniapp / widgets: node session UUID is the owner
 *   key (tab ownership, app authorization). No desktop SessionManager entry
 *   required — keep going through executeSuperoneMcpTool unchanged.
 * - Session-scoped tools that call `getSessionHost().getSession(sessionId)`
 *   (session_rename today) need a desktop Session when available. On a remote
 *   Host Action the claimed.sessionId is a NODE UUID, so local lookup fails.
 *   Route those through EnvironmentHost to the owning node's SessionRuntime.
 *
 * Dynamic import keeps EnvironmentHost loadable in unit tests that only mock
 * electron partially (tool-surface pulls logger / BrowserWindow).
 */

import type { ClaimHostActionResult } from '@superone/shared/environment'
import type { HostActionExecutor } from './remote-host-action-consumer'

/**
 * Tools that mutate node session metadata, not desktop-local resources.
 * claimed.sessionId is the node session UUID — local SessionManager has no
 * entry, so these must call EnvironmentHost → node RPC instead of
 * executeSuperoneMcpTool.
 */
const REMOTE_SESSION_SCOPED_TOOLS = new Set(['session_rename'])

/**
 * Node-local collab tools must never HA-route to desktop SessionManager.
 * Catalog no longer advertises them; reject stale claims with failed_precondition.
 */
const NODE_LOCAL_COLLAB_TOOLS = new Set([
  'session_collab_list_agents',
  'session_collab_request',
  'session_collab_start',
  'session_collab_send',
  'session_collab_retrieve',
])

type ExecutorResult = {
  outcome: 'succeeded' | 'failed'
  result?: unknown
  error?: unknown
}

/** Wall-clock cap for a single host-action tool execution (ms). */
const HOST_ACTION_EXECUTION_TIMEOUT_MS = 120_000

export const desktopHostActionExecutor: HostActionExecutor = async (
  claimed,
  signal,
  connectionId,
) => {
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

  // Linked controller: outer abort + timeout cancel cooperative tools
  // (session-scoped remote RPC honors signal). Non-cooperative MCP tools may
  // still finish later — Promise.race already quarantines their *reported*
  // outcome; we log late completions so operators know side effects may apply.
  const runAbort = new AbortController()
  const onOuterAbort = () => runAbort.abort()
  signal.addEventListener('abort', onOuterAbort, { once: true })

  /** First race winner: 'work' | 'deadline'. Late work completions are logged. */
  let raceWinner: 'work' | 'deadline' | null = null

  try {
    const work = (async (): Promise<ExecutorResult> => {
      try {
        if (NODE_LOCAL_COLLAB_TOOLS.has(claimed.toolName)) {
          return {
            outcome: 'failed',
            error: {
              code: 'failed_precondition',
              message:
                `${claimed.toolName} is node-local (SessionRuntime collab). `
                + 'It is not advertised as a Host Action; upgrade the remote node.',
            },
          }
        }

        if (REMOTE_SESSION_SCOPED_TOOLS.has(claimed.toolName)) {
          return await executeRemoteSessionScopedTool(
            claimed,
            args,
            connectionId,
            runAbort.signal,
          )
        }

        const { executeSuperoneMcpTool } = await import('../mcp/superone-mcp-tool-surface')
        const toolResult = await executeSuperoneMcpTool(
          claimed.sessionId,
          claimed.toolName,
          args,
        )
        if (runAbort.signal.aborted || raceWinner === 'deadline') {
          return {
            outcome: 'failed',
            error: {
              code: 'aborted',
              message: 'host action aborted or timed out during execution',
            },
          }
        }
        const isError = Boolean((toolResult as { isError?: boolean })?.isError)
        if (isError) {
          return { outcome: 'failed', error: toolResult, result: toolResult }
        }
        return { outcome: 'succeeded', result: toolResult }
      } finally {
        if (raceWinner === 'deadline') {
          try {
            const { default: log } = await import('../logger')
            log.warn(
              '[host-action] tool completed after timeout/abort (side effects may have applied):',
              claimed.toolName,
              claimed.actionId,
            )
          } catch {
            /* logger optional in tests */
          }
        }
      }
    })()

    void work.catch(() => undefined)

    const deadline = new Promise<ExecutorResult>((resolve) => {
      const timer = setTimeout(() => {
        runAbort.abort()
        resolve({
          outcome: 'failed',
          error: {
            code: 'timeout',
            message: `host action exceeded ${HOST_ACTION_EXECUTION_TIMEOUT_MS}ms`,
          },
        })
      }, HOST_ACTION_EXECUTION_TIMEOUT_MS)
      // Outer consumer abort only (not runAbort — timeout also aborts that).
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve({
            outcome: 'failed',
            error: { code: 'aborted', message: 'host action aborted during execution' },
          })
        },
        { once: true },
      )
    })

    const result = await Promise.race([
      work.then((r) => {
        if (raceWinner == null) raceWinner = 'work'
        return r
      }),
      deadline.then((r) => {
        if (raceWinner == null) raceWinner = 'deadline'
        return r
      }),
    ])
    return result
  } catch (err) {
    if (signal.aborted || runAbort.signal.aborted) {
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
  } finally {
    signal.removeEventListener('abort', onOuterAbort)
  }
}

async function executeRemoteSessionScopedTool(
  claimed: ClaimHostActionResult,
  args: Record<string, unknown>,
  connectionId: string,
  signal: AbortSignal,
): Promise<ExecutorResult> {
  switch (claimed.toolName) {
    case 'session_rename':
      return renameRemoteSession(claimed, args, connectionId, signal)
    default:
      return {
        outcome: 'failed',
        error: {
          code: 'executor_error',
          message: `unsupported session-scoped host action: ${claimed.toolName}`,
        },
      }
  }
}

/** Verbatim local renameSessionTool user_locked text — tool desc matches on this token. */
const USER_LOCKED_REPLY = {
  content: [
    {
      type: 'text' as const,
      text: 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session.',
    },
  ],
  isError: true as const,
}

/** Match local renameSessionTool reply shape so the agent sees a consistent result. */
async function renameRemoteSession(
  claimed: ClaimHostActionResult,
  args: Record<string, unknown>,
  connectionId: string,
  signal: AbortSignal,
): Promise<ExecutorResult> {
  const rawTitle = typeof args.title === 'string' ? args.title : ''
  const trimmed = rawTitle.trim().replace(/^["']+|["']+$/g, '').trim()
  if (!trimmed) {
    const result = {
      content: [{ type: 'text' as const, text: 'Error: empty title.' }],
      isError: true,
    }
    return { outcome: 'failed', error: result, result }
  }

  const { getEnvironmentHost } = await import('./environment-host')
  try {
    await getEnvironmentHost().renameSession(connectionId, claimed.sessionId, trimmed, 'agent')
  } catch (err) {
    if (isUserLockedError(err)) {
      return { outcome: 'failed', error: USER_LOCKED_REPLY, result: USER_LOCKED_REPLY }
    }
    throw err
  }

  if (signal.aborted) {
    return {
      outcome: 'failed',
      error: { code: 'aborted', message: 'host action aborted during execution' },
    }
  }

  const result = {
    content: [{ type: 'text' as const, text: `Session renamed to "${trimmed}".` }],
  }
  return { outcome: 'succeeded', result }
}

function isUserLockedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'user_locked') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('user_locked')
}
