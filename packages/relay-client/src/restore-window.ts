import type { AgentEvent } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { ControlLease, MutatingControlContext } from '@superone/shared/environment/lease'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment/descriptor'
import type { ProjectRef, SessionRef } from '@superone/shared/environment/refs'
import {
  isUnservedMethod,
  TRANSCRIPT_WINDOW_METHOD,
  TRANSCRIPT_WINDOW_SCHEMA,
  type TranscriptWindowBudget,
  type TranscriptWindowRequest,
  type TranscriptWindowResult,
} from '@superone/shared/environment/transcript-window'
import type { McpAppContextSource } from '@superone/shared/mcp-apps-state'
import {
  applyWindowResult,
  windowCoverage,
  windowLookup,
  type TranscriptWindowState,
} from '@superone/shared/transcript-window/window-store'
import { isAbortError, type RelayClient } from './client'
import { RestoreRejectedError, snapshotFromLoad, type RestoredSession } from './restore'

function aborted(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/** A transcript window kept on the phone for one session: fragment bodies with their digests. */
export type CachedWindow = {
  schema: number
  window: TranscriptWindowState
  provider?: string
  navigationAvailable?: boolean
  mcpAppContexts?: McpAppContextSource[]
}

export type RestoredWindowSession = Omit<RestoredSession, 'messages' | 'hasMore' | 'cursor'> & {
  window: TranscriptWindowState
  /**
   * `stopMs`, `windowMs` (both reads, including a retry without claims) and
   * `acquireMs` overlap; `subscribeMs` runs from the window to the subscription.
   */
  metrics: RestoredSession['metrics'] & { reusedFragments: number; sentFragments: number; stopMs: number; windowMs: number; acquireMs: number }
}

export interface WindowRestoreOptions {
  viewport?: { width: number; height: number }
  budget?: Partial<TranscriptWindowBudget>
  signal?: AbortSignal
  /**
   * The authoritative window is applied. Acquire and subscribe are still in
   * flight; the transcript cover drops here.
   */
  onWindow?: (preview: WindowRestorePreview) => void
}

/** Enough of a restored window to paint the transcript before the lease and the subscription. */
export type WindowRestorePreview = {
  window: TranscriptWindowState
  state: RestoredWindowSession['state']
  snapshot: RestoredWindowSession['snapshot']
  provider?: string
  navigationAvailable: boolean
}

/** The host does not serve transcript windows; restore the legacy way. */
export class TranscriptWindowUnsupportedError extends Error {
  override name = 'TranscriptWindowUnsupportedError'
}

const HOST_REFUSALS = new Set(['not_found', 'forbidden', 'failed_precondition', 'lease_stale', 'lease_required', 'identity_conflict'])

/**
 * Open a session as a transcript window. Stop and the window read overlap.
 * Acquire starts once the project ref is known and overlaps the read, except
 * when the feed is already on this session: stop finishes before that acquire,
 * so a proof-less release cannot race an acquire of the same resource.
 * The window is applied before acquire and subscribe finish. Subscribe starts
 * only after stop has finished and the cursor is known, then the buffer is released.
 */
export async function restoreWindowSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  cached: CachedWindow | null,
  options: WindowRestoreOptions = {},
): Promise<RestoredWindowSession> {
  const started = performance.now()
  const signal = options.signal
  client.startBuffering()
  let acquire: SessionAcquire | null = null
  let followed = false
  let stopFailed: unknown
  let stopping = Promise.resolve()
  let stopMs = 0
  try {
    if (signal?.aborted) throw aborted()
    // Stop clears the feed synchronously. The ref has to be read first, or a
    // same-session reopen looks like a switch and races its own release.
    const previous = client.followedSession?.() ?? null
    stopping = client.stopSession().then(() => {}, (error: unknown) => { stopFailed = error ?? new Error('session stop failed') })
      .finally(() => { stopMs = performance.now() - started })
    const project = await client.resolveProject(projectPath)
    if (signal?.aborted) throw aborted()
    const session = { environmentId: project.environmentId, sessionId }
    const same = previous?.environmentId === session.environmentId && previous.sessionId === session.sessionId
    acquire = new SessionAcquire(client, session, same ? stopping : null, signal, () => stopFailed != null)
    const held = cached?.schema === TRANSCRIPT_WINDOW_SCHEMA ? cached.window : null
    const request = (have: boolean): TranscriptWindowRequest & { projectId: string } => ({
      sessionId, projectId: project.projectId, folds: true,
      ...(options.viewport ? { viewport: options.viewport } : {}),
      ...(options.budget ? { budget: options.budget } : {}),
      ...(have && held ? { have: windowCoverage(held.messages) } : {}),
    })
    const readAt = performance.now()
    const [first, descriptor] = await Promise.all([
      readWindow(client, project, request(true), signal),
      client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor', {}, { environmentId: project.environmentId, signal }),
    ])
    let result = first
    let applied = applyWindowResult(null, result, windowLookup(held))
    // The cache lost a body it claimed: read again without claiming anything.
    if (applied.missing.length) {
      if (signal?.aborted) throw aborted()
      result = await readWindow(client, project, request(false), signal)
      applied = applyWindowResult(null, result, windowLookup(null))
    }
    const windowAt = performance.now()
    if (signal?.aborted) throw aborted()
    const state = result.state ?? {}
    const provider = typeof state.sessionProvider === 'string' ? state.sessionProvider : cached?.provider
    const navigationAvailable = descriptor.capabilities.methods.includes('session.historyIndex')
    const snapshot = snapshotFromLoad({ sessionId, state, messages: [], before: null, cursor: result.cursor, ...(result.restore ? { restore: result.restore } : {}) }, project.environmentId)
    options.onWindow?.({ window: applied.state, state: { ...createDefaultChatCoreSession(), ...state }, snapshot, provider, navigationAvailable })
    await stopping
    if (stopFailed) throw stopFailed
    if (signal?.aborted) throw aborted()
    await acquire.finish()
    if (signal?.aborted) throw aborted()
    followed = true
    await client.followSession({ session, projectPath, provider, cursor: result.cursor })
    const subscribedAt = performance.now()
    const { epoch, batches } = client.releaseBuffer()
    const liveBatches = batches.map(batch => batch.filter(value => {
      const event = value as AgentEvent
      return (!event.environmentId || event.environmentId === session.environmentId)
        && (!event.sessionId || event.sessionId === sessionId)
        && (event.seq == null || event.seq > result.cursor.version)
    })).filter(batch => batch.length)
    const fragments = result.messages.flatMap(message => message.fragments)
    return {
      window: applied.state,
      state: { ...createDefaultChatCoreSession(), ...state },
      snapshot, liveBatches, epoch, provider, navigationAvailable,
      metrics: {
        snapshotMs: windowAt - started, historyMs: 0, subscribeMs: subscribedAt - windowAt, totalMs: subscribedAt - started,
        stopMs, windowMs: windowAt - readAt, acquireMs: acquire.ms,
        historyBytes: new TextEncoder().encode(JSON.stringify(result.messages)).length,
        snapshotBytes: new TextEncoder().encode(JSON.stringify(state)).length,
        reusedFragments: fragments.filter(fragment => !fragment.body).length,
        sentFragments: fragments.filter(fragment => fragment.body).length,
      },
    }
  } catch (error) {
    client.releaseBuffer()
    if (!followed) await acquire?.abandon()
    await stopping.catch(() => {})
    await client.stopSession().catch(() => {})
    if (isAbortError(error) || error instanceof TranscriptWindowUnsupportedError) throw error
    if (HOST_REFUSALS.has((error as { code?: string }).code ?? '')) throw new RestoreRejectedError((error as Error).message, { cause: error })
    throw error
  }
}

/**
 * An acquire beside the window read. If the transition ends before the grant
 * is handed to the feed, the grant is released with its own proof.
 */
class SessionAcquire {
  private abandoned = false
  private lease: ControlLease | undefined
  private readonly pending: Promise<ControlLease>
  /** From start to grant, including a same-session wait on stop. */
  ms = 0

  constructor(
    private readonly client: RelayClient,
    private readonly session: SessionRef,
    gate: Promise<unknown> | null,
    private readonly signal: AbortSignal | undefined,
    private readonly blocked: () => boolean,
  ) {
    this.pending = this.start(gate)
    void this.pending.catch(() => {})
  }

  finish(): Promise<ControlLease> {
    return this.pending
  }

  /** The transition failed, aborted, or was superseded. A grant that arrives later is not kept. */
  async abandon(): Promise<void> {
    if (this.abandoned) return
    this.abandoned = true
    const lease = this.lease
    if (lease) {
      this.lease = undefined
      await this.release(lease)
      return
    }
    await this.pending.catch(() => {})
  }

  private async start(gate: Promise<unknown> | null): Promise<ControlLease> {
    const startedAt = performance.now()
    const proceed = () => { if (this.abandoned || this.signal?.aborted || this.blocked()) throw aborted() }
    proceed()
    // A gated acquire registers now, so a send issued while stop runs waits for this grant.
    const lease = await this.client.acquireControl(this.session, gate ? { after: gate.then(proceed) } : {})
    this.ms = performance.now() - startedAt
    this.lease = lease
    if (this.abandoned || this.signal?.aborted) {
      await this.release(lease)
      throw aborted()
    }
    return lease
  }

  private async release(lease: ControlLease): Promise<void> {
    this.lease = undefined
    if (!lease.leaseId || !lease.generation) return
    await this.client.releaseControl(this.session, { leaseId: lease.leaseId, generation: lease.generation }).catch(() => {})
  }
}

async function readWindow(client: RelayClient, project: ProjectRef, request: TranscriptWindowRequest, signal?: AbortSignal): Promise<TranscriptWindowResult> {
  try {
    return await client.rpc<TranscriptWindowResult>(TRANSCRIPT_WINDOW_METHOD, request, { environmentId: project.environmentId, signal })
  } catch (error) {
    if (isUnservedMethod(error)) throw new TranscriptWindowUnsupportedError(TRANSCRIPT_WINDOW_METHOD, { cause: error })
    throw error
  }
}
