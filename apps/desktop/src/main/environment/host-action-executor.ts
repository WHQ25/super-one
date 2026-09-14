/**
 * Production Host Action executor — dispatches claimed actions to the real
 * desktop SuperOne MCP tool surface (`executeSuperoneMcpTool`).
 *
 * sessionId identity:
 * - Browser / Computer Use / miniapp / widgets: node session UUID is the owner
 *   key (tab ownership, app authorization). No desktop SessionManager entry
 *   required — keep going through executeSuperoneMcpTool unchanged.
 * - Session-scoped tools that call `getSessionHost().getSession(sessionId)`
 *   (session_rename title) need a desktop Session when available. On a remote
 *   Host Action the claimed.sessionId is a NODE UUID, so local lookup fails.
 *   Route the title through EnvironmentHost to the owning node's SessionRuntime.
 *   Tags stay on the host archive (SQLite), not the node store.
 *
 * Dynamic import keeps EnvironmentHost loadable in unit tests that only mock
 * electron partially (tool-surface pulls logger / BrowserWindow).
 */

import type { ClaimHostActionResult } from '@superone/shared/environment'
import { releaseWriteClaim, takeSealedClaim } from './active-writes'
import { handoffOwns } from './pending-handoffs'
import type { HostActionExecutor } from './remote-host-action-consumer'
import {
  mapHostActionInputs,
  withInputMapping,
  syncHostActionOutputs,
  type HostActionSyncDeps,
  type ToolReply,
} from './host-action-sync'

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

        // Session sync zone (docs/design/session-sync-zone.md §3): a node that
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
        const { result: rawResult, artifacts } = sync
          ? await withInputMapping({ ...sync, sessionId: claimed.sessionId }, runTool)
          : await runTool()
        // The tool's call scope is already closed, so anything it produced is
        // named by nothing durable until this push lands or defers a job.
        //
        // Ownership, not "it appeared in the reply": `adoptWriteClaim` refuses
        // a file that is still being written, so a tool that went background on
        // its deadline leaves its download protected for the writer to finish;
        // and it refuses one the transfer queue already took, so two handoffs
        // never race to free one file. Only what this push actually adopted is
        // released here.
        //
        // The cancellation checks are INSIDE the region on purpose. They return
        // early, and a sealed claim abandoned by an early return has no one left
        // to hand it on — it would pin its path for the life of the process.
        const adopted: string[] = []
        try {
          // Protection is taken BEFORE the first node RPC, not after the push
          // decides to give up. `syncHostActionOutputs` stats the node, hashes
          // and uploads — all awaits — and a directory mirror running during
          // any of them would prune a file nothing was holding yet. Only
          // downloads reserve a path, so `takeSealedClaim` also *creates* the
          // claim for a screenshot or a generated image that never made one.
          //
          // Adopted BEFORE the cancellation check, so the `finally` frees them
          // on every exit. A cancel that lands as the tool completes used to
          // return past this point, leaving a sealed file with no holder left
          // to hand it on — pinned against the prune for the process's life.
          for (const ref of artifacts) {
            // Not ours: a writer is still filling this one, or a handoff task
            // already owns it and is the only thing that may end it.
            if (!ref.final || handoffOwns(claimed.sessionId, ref.path, connectionId)) continue
            if (takeSealedClaim(claimed.sessionId, ref.path, 'push')) adopted.push(ref.path)
          }
          if (runAbort.signal.aborted || raceWinner === 'deadline') return aborted()

          const toolResult = sync && artifacts.length > 0
            ? await syncHostActionOutputs(claimed.sessionId, artifacts, rawResult as ToolReply, claimed.claimExpiresAt, sync)
            : rawResult
          if (runAbort.signal.aborted || raceWinner === 'deadline') return aborted()

          const isError = Boolean((toolResult as { isError?: boolean })?.isError)
          if (isError) {
            return { outcome: 'failed', error: toolResult, result: toolResult }
          }
          return { outcome: 'succeeded', result: toolResult }
        } finally {
          for (const path of adopted) {
            // Handed on during the sync: a handoff task took the claim and is
            // the only thing that may end it. Releasing here would leave the
            // only complete copy unprotected with nothing naming it, which is
            // the failure this whole region exists to prevent.
            if (handoffOwns(claimed.sessionId, path, connectionId)) continue
            releaseWriteClaim(claimed.sessionId, path, 'push')
          }
        }
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
            message: `host action exceeded ${HOST_ACTION_EXECUTION_TIMEOUT_MS}ms`,
          },
        })
      }, HOST_ACTION_EXECUTION_TIMEOUT_MS)
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
  const { applyRenameTags } = await import('../mcp/session-tag-tools')
  let tagNote = ''
  if (args.tags !== undefined) {
    const applied = applyRenameTags(claimed.sessionId, args.tags)
    if ('error' in applied) {
      const result = {
        content: [{ type: 'text' as const, text: `Error: ${applied.error}` }],
        isError: true,
      }
      return { outcome: 'failed', error: result, result }
    }
    tagNote = ` Tags: ${JSON.stringify(applied)}.`
  }

  try {
    await getEnvironmentHost().renameSession(connectionId, claimed.sessionId, trimmed, 'agent')
  } catch (err) {
    if (isUserLockedError(err)) {
      const locked = tagNote
        ? {
            content: [{
              type: 'text' as const,
              text: `${USER_LOCKED_REPLY.content[0].text} Tags applied.${tagNote}`,
            }],
            isError: true as const,
          }
        : USER_LOCKED_REPLY
      return { outcome: 'failed', error: locked, result: locked }
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
    content: [{ type: 'text' as const, text: `Session renamed to "${trimmed}".${tagNote}` }],
  }
  return { outcome: 'succeeded', result }
}

function isUserLockedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'user_locked') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('user_locked')
}
