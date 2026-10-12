import type { AgentEvent } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment/descriptor'
import type { ProjectRef } from '@superone/shared/environment/refs'
import {
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
import type { RelayClient } from './client'
import { RestoreRejectedError, snapshotFromLoad, type RestoredSession } from './restore'

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
  metrics: RestoredSession['metrics'] & { reusedFragments: number; sentFragments: number }
}

export interface WindowRestoreOptions {
  viewport?: { width: number; height: number }
  budget?: Partial<TranscriptWindowBudget>
}

/** The host does not serve transcript windows; restore the legacy way. */
export class TranscriptWindowUnsupportedError extends Error {
  override name = 'TranscriptWindowUnsupportedError'
}

const HOST_REFUSALS = new Set(['not_found', 'forbidden', 'failed_precondition', 'lease_stale', 'lease_required', 'identity_conflict'])

/**
 * Open a session as a transcript window: read the newest bounded window at
 * one cursor, claiming the fragments the cached window holds so the host omits
 * their bodies, then acquire control and follow from that cursor, as
 * `restoreSession` does.
 */
export async function restoreWindowSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
  cached: CachedWindow | null,
  options: WindowRestoreOptions = {},
): Promise<RestoredWindowSession> {
  const started = performance.now()
  client.startBuffering()
  try {
    await client.stopSession()
    const project = await client.resolveProject(projectPath)
    const held = cached?.schema === TRANSCRIPT_WINDOW_SCHEMA ? cached.window : null
    const request = (have: boolean): TranscriptWindowRequest & { projectId: string } => ({
      sessionId, projectId: project.projectId,
      ...(options.viewport ? { viewport: options.viewport } : {}),
      ...(options.budget ? { budget: options.budget } : {}),
      ...(have && held ? { have: windowCoverage(held.messages) } : {}),
    })
    const [first, descriptor] = await Promise.all([
      readWindow(client, project, request(true)),
      client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor', {}, { environmentId: project.environmentId }),
    ])
    let result = first
    let applied = applyWindowResult(null, result, windowLookup(held))
    // The cache lost a body it claimed: read again without claiming anything.
    if (applied.missing.length) {
      result = await readWindow(client, project, request(false))
      applied = applyWindowResult(null, result, windowLookup(null))
    }
    const windowAt = performance.now()
    const session = { environmentId: project.environmentId, sessionId }
    await client.acquireControl(session)
    const state = result.state ?? {}
    const provider = typeof state.sessionProvider === 'string' ? state.sessionProvider : cached?.provider
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
      snapshot: snapshotFromLoad({ sessionId, state, messages: [], before: null, cursor: result.cursor, ...(result.restore ? { restore: result.restore } : {}) }, project.environmentId),
      liveBatches, epoch, provider,
      navigationAvailable: descriptor.capabilities.methods.includes('session.historyIndex'),
      metrics: {
        snapshotMs: windowAt - started, historyMs: 0, subscribeMs: subscribedAt - windowAt, totalMs: subscribedAt - started,
        historyBytes: new TextEncoder().encode(JSON.stringify(result.messages)).length,
        snapshotBytes: new TextEncoder().encode(JSON.stringify(state)).length,
        reusedFragments: fragments.filter(fragment => !fragment.body).length,
        sentFragments: fragments.filter(fragment => fragment.body).length,
      },
    }
  } catch (error) {
    client.releaseBuffer()
    await client.stopSession().catch(() => {})
    if (error instanceof TranscriptWindowUnsupportedError) throw error
    if (HOST_REFUSALS.has((error as { code?: string }).code ?? '')) throw new RestoreRejectedError((error as Error).message, { cause: error })
    throw error
  }
}

async function readWindow(client: RelayClient, project: ProjectRef, request: TranscriptWindowRequest): Promise<TranscriptWindowResult> {
  try {
    return await client.rpc<TranscriptWindowResult>(TRANSCRIPT_WINDOW_METHOD, request, { environmentId: project.environmentId })
  } catch (error) {
    if ((error as { code?: string }).code === 'unsupported') throw new TranscriptWindowUnsupportedError(TRANSCRIPT_WINDOW_METHOD, { cause: error })
    throw error
  }
}
