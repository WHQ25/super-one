/**
 * Production Host Action executor — dispatches claimed actions to the real
 * desktop SuperOne MCP tool surface (`executeSuperoneMcpTool`).
 *
 * sessionId identity:
 * - Browser / Computer Use / miniapp / widgets: node session UUID is the owner
 *   key (tab ownership, app authorization). No desktop SessionManager entry
 *   required — keep going through executeSuperoneMcpTool unchanged.
 * - session_rename, session_tag, and session_cleanup: claimed.sessionId is a
 *   node UUID, so the desktop archive has no row. Write through EnvironmentHost
 *   onto the owning node's SessionRuntime. Rename and tag RPCs append
 *   session.renamed and session.tags_changed, which the node already publishes
 *   as session_list_changed. Cleanup settles through session.cleanup (setUiFlags
 *   / remove). Do not copy the session into the desktop database. session_tag
 *   still runs the desktop main-thread guard first; the node cannot see ACP
 *   subagents. session_tag_list is an archive read and stays on archiveRead.
 *
 * Dynamic import keeps EnvironmentHost loadable in unit tests that only mock
 * electron partially (tool-surface pulls logger / BrowserWindow).
 */

import type { ClaimHostActionResult } from '@superone/shared/environment'
import { SESSION_CLEANUP_HOST_ACTION_DEADLINE_MS } from '@superone/shared/session-cleanup'
import { isLocalSessionOnlySuperoneTool } from '@superone/shared/environment/host-action-browser-catalog'
import { normalizeSessionTagList, planSessionTagUpdate, sessionTagUpdateBody, type SessionTagOp } from '@superone/shared/session-tags'
import { denyMainThreadOnlyIfSubagent } from '../mcp/main-thread-session-guard'
import type { HostActionExecutor } from './remote-host-action-consumer'
import {
  mapHostActionInputs,
  withInputMapping,
  syncHostActionOutputs,
  type HostActionSyncDeps,
  type ToolReply,
} from './host-action-sync'
import { releaseHeldDeliveries } from '../mcp/artifact-registry'

/**
 * Tools that mutate node session metadata, not desktop-local resources.
 * claimed.sessionId is the node session UUID — local SessionManager has no
 * entry, so these must call EnvironmentHost → node RPC instead of
 * executeSuperoneMcpTool.
 */
const REMOTE_SESSION_SCOPED_TOOLS = new Set(['session_rename', 'session_tag', 'session_cleanup'])

/**
 * Launching stays node-local (SessionRuntime collab) and is never advertised as
 * a Host Action; reject stale claims with failed_precondition.
 */
const NODE_LOCAL_COLLAB_TOOLS = new Set([
  'session_collab_list_agents',
  'session_collab_request',
  'session_collab_start',
])

/**
 * Mailbox tools of a collaboration child this desktop launched on the node:
 * the mailbox is here, so the child's send/retrieve run against it.
 */
const REMOTE_CHILD_MAILBOX_TOOLS = new Set(['session_collab_send', 'session_collab_retrieve'])

type ExecutorResult = Awaited<ReturnType<HostActionExecutor>>

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
  const executionTimeoutMs = claimed.toolName === 'session_cleanup'
    ? SESSION_CLEANUP_HOST_ACTION_DEADLINE_MS
    : HOST_ACTION_EXECUTION_TIMEOUT_MS
  const runAbort = new AbortController()
  const onOuterAbort = () => runAbort.abort()
  signal.addEventListener('abort', onOuterAbort, { once: true })

  /** First race winner: 'work' | 'deadline'. Late work completions are logged. */
  let raceWinner: 'work' | 'deadline' | null = null
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined

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

        if (isLocalSessionOnlySuperoneTool(claimed.toolName)) {
          return {
            outcome: 'failed',
            error: {
              code: 'failed_precondition',
              message: `${claimed.toolName} works only in a session on this desktop; it is not advertised as a Host Action.`,
            },
          }
        }

        if (REMOTE_CHILD_MAILBOX_TOOLS.has(claimed.toolName)) {
          return await runRemoteChildMailboxTool(claimed, args, connectionId)
        }

        if (REMOTE_SESSION_SCOPED_TOOLS.has(claimed.toolName)) {
          return await executeRemoteSessionScopedTool(
            claimed,
            args,
            connectionId,
            runAbort.signal,
          )
        }

        const aborted = (): ExecutorResult => ({
          outcome: 'failed',
          error: {
            code: 'aborted',
            message: 'host action aborted or timed out during execution',
          },
        })

        // Session sync zone (docs/architecture/session-sync-zone.md §3): a node that
        // reports its zone gets node-zone args mapped to the desktop mirror
        // first, and desktop-produced outputs pushed and rewritten afterwards.
        // Older nodes report no zone and get today's behaviour unchanged.
        const sync = await resolveSyncContext(connectionId, runAbort.signal, {
          actionId: claimed.actionId,
          claimToken: claimed.claimToken,
        })
        const mappedArgs = sync ? await mapHostActionInputs(args, { ...sync, sessionId: claimed.sessionId, toolName: claimed.toolName }) : args
        if (runAbort.signal.aborted || raceWinner === 'deadline') return aborted()

        const { executeSuperoneMcpToolCollecting } = await import('../mcp/superone-mcp-tool-surface')
        if (runAbort.signal.aborted || raceWinner === 'deadline') return aborted()
        const runTool = () => executeSuperoneMcpToolCollecting(
          claimed.sessionId,
          claimed.toolName,
          mappedArgs,
          runAbort.signal,
          connectionId,
        )
        // A wrapper tool maps the arguments of the tool it dispatches at the
        // point of dispatch, by that tool's roles; it finds the mapping here.
        const { result: rawResult, artifacts, held } = sync
          ? await withInputMapping({ ...sync, sessionId: claimed.sessionId }, runTool)
          : await runTool()
        // The executor holds no claims of its own. Protection and delivery are
        // one responsibility and `syncHostActionOutputs` owns it end to end:
        // it takes ownership of the held delivery handles, pushes selected
        // files through the committing gate, abandons unmentioned outputs,
        // and releases unfinished handles to the worker in its finally.
        // Taking separate claims here would give cancellation a second owner
        // for the same delivery.
        //
        // Which is why a cancelled action is NOT short-circuited here. The sync
        // takes the held handles even when the signal is already aborted,
        // so its `finally` releases unfinished deliveries. Returning early
        // instead would strand sealed outputs under the writer's holder,
        // unavailable to the worker until that holder is retired.
        let toolResult: unknown
        if (sync && artifacts.length > 0) {
          // The held handles this call owns are threaded in so the selection
          // holds each file live through its decision (E090-4).
          toolResult = await syncHostActionOutputs(claimed.sessionId, artifacts, held, rawResult as ToolReply, claimed.claimExpiresAt, sync)
        } else {
          // No selection will run: release any rows the call was still holding
          // to the worker (a local or output-less call normally holds none).
          releaseHeldDeliveries(held.values())
          toolResult = rawResult
        }
        if (runAbort.signal.aborted || raceWinner === 'deadline') return aborted()

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
      deadlineTimer = setTimeout(() => {
        runAbort.abort()
        resolve({
          outcome: 'failed',
          error: {
            code: 'timeout',
            message: `host action exceeded ${executionTimeoutMs}ms`,
          },
        })
      }, executionTimeoutMs)
      // Outer consumer abort only (not runAbort — timeout also aborts that).
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(deadlineTimer)
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
    // The deadline was only ever cleared when the OUTER signal aborted, so a
    // Host Action that simply succeeded left a live timer behind for the rest
    // of the timeout — holding the event loop open and firing an abort on a
    // controller nobody is listening to any more.
    clearTimeout(deadlineTimer)
  }
}

/**
 * Everything the sync steps need for one connection, or null when the node
 * has no zone. Dynamic import keeps EnvironmentHost out of the unit graph.
 */
async function resolveSyncContext(
  connectionId: string,
  signal: AbortSignal,
  claim: { actionId: string; claimToken: string },
): Promise<HostActionSyncDeps | null> {
  const { getEnvironmentHost } = await import('./environment-host')
  const host = getEnvironmentHost()
  const zone = host.getSyncZone(connectionId)
  if (!zone) return null
  const transfers = host.artifactTransfers
  if (!transfers) return null
  return {
    zone,
    connectionId,
    signal,
    renewClaim: (ttlMs) => host.renewHostActionClaim(connectionId, { ...claim, ttlMs }),
    put: (input) => host.artifactPut(connectionId, input),
    get: (input) => host.artifactGet(connectionId, input),
    stat: (input) => host.artifactStat(connectionId, input.sessionId, input.relativePath),
    list: (input) => host.artifactList(connectionId, input),
    transfers,
    log: {
      warn: (...args) => void import('../logger').then((m) => m.default.warn(...args)).catch(() => undefined),
    },
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
    case 'session_tag':
      return tagRemoteSession(claimed, args, connectionId, signal)
    case 'session_cleanup':
      return cleanupRemoteSession(claimed, args, connectionId, signal)
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

async function runRemoteChildMailboxTool(
  claimed: ClaimHostActionResult,
  args: Record<string, unknown>,
  connectionId: string,
): Promise<ExecutorResult> {
  const { getEnvironmentHost } = await import('./environment-host')
  const environmentId = getEnvironmentHost().environmentIdOf(connectionId)
  const { runRemoteChildMailboxTool: run } = await import('../session/session-collaboration')
  const { reply, onResponded } = await run(environmentId, claimed.sessionId, claimed.toolName, args)
  return reply.isError
    ? { outcome: 'failed', error: reply, result: reply }
    : { outcome: 'succeeded', result: reply, ...(onResponded ? { onResponded } : {}) }
}

/** Verbatim local renameSessionTool user_locked text — tool desc matches on this token. */
const USER_LOCKED_TEXT = 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session.'

function textReply(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true as const } : {}),
  }
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
    const result = textReply('Error: empty title.', true)
    return { outcome: 'failed', error: result, result }
  }

  const { getEnvironmentHost } = await import('./environment-host')
  const host = getEnvironmentHost()
  let tagNote = ''
  if (args.tags !== undefined) {
    const parsed = normalizeSessionTagList(args.tags)
    if ('error' in parsed) {
      const result = textReply(`Error: ${parsed.error}`, true)
      return { outcome: 'failed', error: result, result }
    }
    try {
      await host.setSessionTags(connectionId, claimed.sessionId, { set: parsed.tags })
    } catch (err) {
      if (isSessionNotFoundError(err)) {
        const result = textReply(`Error: Session not found: ${claimed.sessionId}`, true)
        return { outcome: 'failed', error: result, result }
      }
      throw err
    }
    tagNote = ` Tags: ${JSON.stringify(parsed.tags)}.`
  }

  try {
    await host.renameSession(connectionId, claimed.sessionId, trimmed, 'agent')
  } catch (err) {
    if (isUserLockedError(err)) {
      const locked = textReply(
        tagNote ? `${USER_LOCKED_TEXT} Tags applied.${tagNote}` : USER_LOCKED_TEXT,
        true,
      )
      return { outcome: 'failed', error: locked, result: locked }
    }
    if (isSessionNotFoundError(err)) {
      const result = textReply(`Error: Session not found: ${claimed.sessionId}`, true)
      return { outcome: 'failed', error: result, result }
    }
    throw err
  }

  if (signal.aborted) {
    return {
      outcome: 'failed',
      error: { code: 'aborted', message: 'host action aborted during execution' },
    }
  }

  const result = textReply(`Session renamed to "${trimmed}".${tagNote}`)
  return { outcome: 'succeeded', result }
}

/** Send the op itself. The node applies add/remove/set and appends session.tags_changed. */
function sessionTagRpcOp(op: SessionTagOp): { add?: string[]; remove?: string[]; set?: string[] } {
  if (op.kind === 'add') return { add: op.tags }
  if (op.kind === 'remove') return { remove: op.tags }
  return { set: op.tags }
}

function tagsFromNodeRecord(record: unknown): string[] | null {
  if (!record || typeof record !== 'object' || !Array.isArray((record as { tags?: unknown }).tags)) return null
  return (record as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string')
}

async function tagRemoteSession(
  claimed: ClaimHostActionResult,
  args: Record<string, unknown>,
  connectionId: string,
  signal: AbortSignal,
): Promise<ExecutorResult> {
  const denied = await denyMainThreadOnlyIfSubagent(claimed.sessionId, 'session_tag')
  if (denied) {
    const result = textReply(denied, true)
    return { outcome: 'failed', error: result, result }
  }

  const plan = planSessionTagUpdate(args, claimed.sessionId)
  if ('error' in plan) {
    const result = textReply(JSON.stringify({ status: 'error', message: plan.error }), true)
    return { outcome: 'failed', error: result, result }
  }

  const { getEnvironmentHost } = await import('./environment-host')
  const host = getEnvironmentHost()
  const sessions: Array<{ sessionId: string; tags: string[] }> = []
  const missing: string[] = []
  const failed: Array<{ sessionId: string; message: string }> = []
  const opArgs = sessionTagRpcOp(plan.op)

  for (const sessionId of plan.targets) {
    try {
      const record = await host.setSessionTags(connectionId, sessionId, opArgs)
      const tags = tagsFromNodeRecord(record)
      if (!tags) {
        failed.push({ sessionId, message: 'session not found' })
        continue
      }
      sessions.push({ sessionId, tags })
    } catch (err) {
      if (isSessionNotFoundError(err)) {
        missing.push(sessionId)
        continue
      }
      if ((err as { code?: string } | null)?.code === 'failed_precondition') {
        failed.push({ sessionId, message: err instanceof Error ? err.message : String(err) })
        continue
      }
      throw err
    }
  }

  if (signal.aborted) {
    return {
      outcome: 'failed',
      error: { code: 'aborted', message: 'host action aborted during execution' },
    }
  }

  const body = sessionTagUpdateBody(plan.targets, sessions, missing, failed)
  const result = textReply(JSON.stringify(body), body.status === 'error')
  return body.status === 'error'
    ? { outcome: 'failed', error: result, result }
    : { outcome: 'succeeded', result }
}

/** Keep an unsafe claim alive while the user answers the delete card. */
const CLEANUP_CLAIM_RENEW_MS = 30_000

async function cleanupRemoteSession(
  claimed: ClaimHostActionResult,
  args: Record<string, unknown>,
  connectionId: string,
  signal: AbortSignal,
): Promise<ExecutorResult> {
  const { getEnvironmentHost } = await import('./environment-host')
  const host = getEnvironmentHost()
  const renew = setInterval(() => {
    void host.renewHostActionClaim(connectionId, {
      actionId: claimed.actionId,
      claimToken: claimed.claimToken,
      ttlMs: 60_000,
    }).catch(() => undefined)
  }, CLEANUP_CLAIM_RENEW_MS)
  try {
    const body = await host.cleanupSession(connectionId, {
      action: args.action,
      sessionIds: args.sessionIds,
      sourceSessionId: claimed.sessionId,
      includePinned: args.includePinned === true,
      ...(args.maxDelete !== undefined ? { maxDelete: args.maxDelete } : {}),
    })
    if (signal.aborted) {
      return { outcome: 'failed', error: { code: 'aborted', message: 'host action aborted during execution' } }
    }
    const record = body && typeof body === 'object' ? body as { status?: unknown } : null
    const status = typeof record?.status === 'string' ? record.status : 'error'
    const result = textReply(
      JSON.stringify(record ?? { status: 'error', message: 'Empty cleanup result' }),
      status === 'error',
    )
    return status === 'error'
      ? { outcome: 'failed', error: result, result }
      : { outcome: 'succeeded', result }
  } catch (err) {
    const result = textReply(err instanceof Error ? err.message : String(err), true)
    return { outcome: 'failed', error: result, result }
  } finally {
    clearInterval(renew)
  }
}

function isSessionNotFoundError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'not_found') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /session not found/i.test(msg)
}

function isUserLockedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'user_locked') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('user_locked')
}
