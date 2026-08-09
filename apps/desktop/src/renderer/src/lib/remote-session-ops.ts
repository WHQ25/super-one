/**
 * Renderer helpers for remote-node session operations.
 * All host-scoped project keys use `remote:<connectionId>:<hostPath>`.
 */
import type { AgentEvent, SessionHistoryEntry } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import {
  createNodeSessionEventMapper,
  mapNodeSessionEvents,
  type NodeSessionEventMapContext,
  type NodeSessionEventMapper,
} from '@superone/shared/node-session-event-map'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  nodeHarnessToProviderId,
  nodePendingInteractionFields,
  nodeSnapshotNeedsLiveDrain,
  nodeStatusToAgentStatus,
  reconcileTranscriptWithLocalMessages,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'
import { mapEnvironmentSessionRow } from '@/lib/session-list-ops'
import { createDefaultPerSessionState } from '@/stores/chat-store/defaults'
import { preferCatalogMessages } from '@/stores/chat-store/helpers/remote-message-catalog'
import { _isLiveSession } from '@/stores/chat-store/helpers/lifecycle'
import type { ChatProvider, PerSessionState } from '@/stores/chat-store/types'

/** @deprecated Prefer mapEnvironmentSessionRow from session-list-ops. */
export const mapNodeRowToHistoryEntry = mapEnvironmentSessionRow

export {
  createNodeSessionEventMapper,
  mapNodeSessionEvents,
  type NodeSessionEventMapContext,
  type NodeSessionEventMapper,
}

export function isRemoteProjectKey(projectPath: string): boolean {
  return parseRemoteProjectKey(projectPath) !== null
}

/**
 * Resolve the node projectId for a host-scoped project key.
 * Prefer an explicit id; otherwise match listProjects by path (never trust
 * another project's currentProjectId).
 */
export async function resolveRemoteProjectId(
  projectKey: string,
  preferredProjectId?: string | null,
): Promise<string | null> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) return null
  if (preferredProjectId) return preferredProjectId
  try {
    const projects = await window.environment.listProjects(remote.connectionId)
    const match = projects.find(
      (p) =>
        `remote:${remote.connectionId}:${p.path}` === projectKey || p.path === remote.path,
    )
    return match?.projectId ?? null
  } catch {
    return null
  }
}

export async function hydrateRemotePerSession(
  projectKey: string,
  sessionId: string,
  previous?: PerSessionState | null,
): Promise<PerSessionState> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) {
    return previous ?? createDefaultPerSessionState()
  }
  const snap = (await window.environment.getSession(
    remote.connectionId,
    sessionId,
  )) as NodeSessionSnapshot | null
  const providerId = nodeHarnessToProviderId(snap?.harnessId || snap?.providerId)
  const base = previous ?? createDefaultPerSessionState()
  // Prefer locally streamed rich content; transcript only fills stream gaps.
  const messages = reconcileTranscriptWithLocalMessages(
    base.messages,
    snap?.transcript,
    providerId,
  )
  const pendingFields = nodePendingInteractionFields(snap?.pendingInteraction)
  const isLive =
    snap?.status === 'streaming' || pendingFields.awaitingAssistantReply
  const chatProvider = (providerId === 'claude' || providerId === 'codex'
    ? providerId
    : 'claude') as ChatProvider
  return {
    ...base,
    // Preserve renderer model/effort selection across node re-hydrate (node has no model field yet).
    selectedModel: previous?.selectedModel ?? base.selectedModel,
    selectedEffort: previous?.selectedEffort ?? base.selectedEffort,
    sessionProvider: chatProvider,
    preferredProvider: chatProvider,
    messages,
    status: isLive ? 'streaming' : nodeStatusToAgentStatus(snap?.status),
    _title: snap?.title ?? base._title ?? null,
    awaitingAssistantReply: isLive,
    pendingPermissions: pendingFields.pendingPermissions,
    pendingQuestion: pendingFields.pendingQuestion,
    pendingPlanApproval: pendingFields.pendingPlanApproval,
    _historyHydrated: true,
  }
}

/**
 * Apply a remote hydrate result without clobbering messages/interaction state
 * that landed via handleAgentEvent while getSession / messages.list were in flight.
 *
 * switchSession snapshots `previous` before those awaits; unconditionally
 * `set(hydrated)` dropped concurrent stream deltas (and can re-open a turn that
 * already settled in memory).
 */
export function mergeRemoteHydrateWithCurrent(
  current: PerSessionState | null | undefined,
  hydrated: PerSessionState,
): PerSessionState {
  if (!current) return hydrated

  const messages = preferCatalogMessages(current.messages, hydrated.messages)
  const currentLive = _isLiveSession(current)
  const hydratedLive = _isLiveSession(hydrated)
  // Prefer in-memory interaction when:
  // - still live (stream advanced during await), or
  // - already settled while the node snapshot still looked live (stale snap).
  const preferCurrentInteraction =
    currentLive || (!currentLive && current.messages.length > 0 && hydratedLive)

  return {
    ...hydrated,
    messages,
    // Composer / queue are renderer-only — never take the pre-await snapshot.
    draftText: current.draftText,
    draftJson: current.draftJson,
    attachments: current.attachments,
    mentions: current.mentions,
    browserAnnotations: current.browserAnnotations,
    queuedMessages: current.queuedMessages,
    promptSuggestion: current.promptSuggestion,
    ...(preferCurrentInteraction
      ? {
          status: current.status,
          awaitingAssistantReply: current.awaitingAssistantReply,
          pendingPermissions: current.pendingPermissions,
          pendingQuestion: current.pendingQuestion,
          pendingPlanApproval: current.pendingPlanApproval,
          lastAssistantMessageId:
            current.lastAssistantMessageId ?? hydrated.lastAssistantMessageId,
        }
      : {}),
    _historyHydrated: true,
  }
}

/**
 * After hydrate/focus: if the node turn is still live, own a drain so events
 * keep flowing into handleAgentEvent (local Session resume parity).
 */
export function resumeRemoteSessionIfLive(
  projectKey: string,
  sessionId: string,
  sess: Pick<
    PerSessionState,
    'status' | 'awaitingAssistantReply' | 'sessionProvider' | 'preferredProvider'
  > & {
    pendingPermissions?: unknown[]
    pendingQuestion?: unknown
    pendingPlanApproval?: unknown
  },
  snap?: NodeSessionSnapshot | null,
): void {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote || !sessionId) return
  const needsDrain =
    nodeSnapshotNeedsLiveDrain(snap ?? null) ||
    sess.status === 'streaming' ||
    sess.awaitingAssistantReply ||
    (sess.pendingPermissions?.length ?? 0) > 0 ||
    Boolean(sess.pendingQuestion) ||
    Boolean(sess.pendingPlanApproval)
  if (!needsDrain) return
  const providerId =
    sess.sessionProvider || sess.preferredProvider || snap?.harnessId || 'claude'
  void window.environment
    .resumeRemoteSessionEvents(remote.connectionId, {
      sessionId,
      projectPath: projectKey,
      providerId: String(providerId),
    })
    .catch((err) => {
      console.warn('[chat] resumeRemoteSessionEvents failed:', err)
    })
}

/**
 * Default harness when the UI has not chosen one yet.
 * Matches local `preferredProvider` default (`claude`) — not forced codex.
 */
const DEFAULT_NODE_HARNESS = 'claude'

export async function createRemoteSession(
  projectKey: string,
  projectId: string,
  title?: string,
  opts?: { harnessId?: string; providerId?: string },
): Promise<{ sessionId: string; entry: SessionHistoryEntry }> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) throw new Error('not a remote project key')
  const harnessId = opts?.harnessId ?? DEFAULT_NODE_HARNESS
  const created = await window.environment.createSession(remote.connectionId, {
    projectId,
    title,
    harnessId,
    providerId: opts?.providerId ?? harnessId,
  })
  return {
    sessionId: created.sessionId,
    entry: mapNodeRowToHistoryEntry({
      ...created,
      provider: created.provider ?? harnessId,
    }),
  }
}

/**
 * Ensure `candidateSessionId` exists on the remote node.
 *
 * Opening a remote project mints a renderer-only draft UUID via `ensureSession`
 * (same as local) — that id is not on the node until first send. Prefer the
 * candidate when `session.get` succeeds; otherwise create a real node session
 * with the harness from the UI tab (caller should pass harnessId).
 */
export async function resolveNodeSessionId(
  projectKey: string,
  projectId: string,
  candidateSessionId: string | null | undefined,
  opts?: { harnessId?: string; providerId?: string },
): Promise<{ sessionId: string; created: boolean }> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) throw new Error('not a remote project key')
  if (!projectId) throw new Error('projectId is required')

  const wantHarness = opts?.harnessId ?? DEFAULT_NODE_HARNESS

  if (candidateSessionId) {
    try {
      const snap = (await window.environment.getSession(
        remote.connectionId,
        candidateSessionId,
      )) as NodeSessionSnapshot | null
      // Draft UUIDs are not on the node — getSession returns null (not throw).
      if (snap && snap.sessionId) {
        const snapHarness = String(snap.harnessId || snap.providerId || '').toLowerCase()
        // Reuse only when harness matches the UI tab (or snap has no harness field).
        // A prior codex node session must not swallow a Claude-tab send.
        if (!snapHarness || snapHarness === wantHarness) {
          return { sessionId: String(snap.sessionId), created: false }
        }
        // Wrong harness — fall through to create.
      }
    } catch {
      // Missing / revoked / transport — create a fresh node session below.
    }
  }

  try {
    const created = await window.environment.createSession(remote.connectionId, {
      projectId,
      harnessId: wantHarness,
      providerId: opts?.providerId ?? wantHarness,
    })
    return { sessionId: created.sessionId, created: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Clearer than raw RPC: common lab case is claude catalog not enabled.
    if (/harness not ready/i.test(msg)) {
      throw new Error(
        `Remote harness "${wantHarness}" is not ready on the node. ` +
          `Enable it (e.g. superone harness enable ${wantHarness}) or switch the chat tab to a ready harness. ` +
          `(${msg})`,
      )
    }
    throw err
  }
}

/** Build a mapper scoped to a remote project key + node session id. */
export function createRemoteSessionEventMapper(
  projectKey: string,
  sessionId: string,
  providerId = 'claude',
): NodeSessionEventMapper {
  return createNodeSessionEventMapper({
    projectPath: projectKey,
    sessionId,
    providerId,
  })
}

/**
 * Poll `session.events` after `afterSequence` and map to AgentEvents for one session.
 * Returns mapped events plus the exclusive cursor for the next poll.
 */
export async function pollRemoteSessionAgentEvents(
  projectKey: string,
  sessionId: string,
  afterSequence: string,
  mapper?: NodeSessionEventMapper,
  providerId = 'claude',
): Promise<{ agentEvents: AgentEvent[]; nextSequence: string; raw: EnvironmentEventEnvelope[] }> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) throw new Error('not a remote project key')

  const raw = (await window.environment.listSessionEvents(
    remote.connectionId,
    afterSequence,
  )) as EnvironmentEventEnvelope[]
  const events = Array.isArray(raw) ? raw : []
  let nextSequence = afterSequence
  const activeMapper =
    mapper ?? createRemoteSessionEventMapper(projectKey, sessionId, providerId)
  const agentEvents: AgentEvent[] = []
  for (const ev of events) {
    nextSequence = ev.sequence
    if (ev.aggregateType === 'session' && ev.aggregateId === sessionId) {
      agentEvents.push(...activeMapper.map(ev))
    }
  }
  return { agentEvents, nextSequence, raw: events }
}
