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
  nodePendingToPermissionRequest,
  nodeStatusToAgentStatus,
  transcriptToChatMessages,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'
import { createDefaultPerSessionState } from '@/stores/chat-store/defaults'
import type { ChatProvider, PerSessionState } from '@/stores/chat-store/types'

export {
  createNodeSessionEventMapper,
  mapNodeSessionEvents,
  type NodeSessionEventMapContext,
  type NodeSessionEventMapper,
}

export function isRemoteProjectKey(projectPath: string): boolean {
  return parseRemoteProjectKey(projectPath) !== null
}

export function mapNodeRowToHistoryEntry(row: {
  sessionId: string
  title: string
  lastActiveAt: string
  provider?: string
  messageCount: number
  isPinned?: boolean
  isHidden?: boolean
}): SessionHistoryEntry {
  return {
    sessionId: row.sessionId,
    title: row.title,
    lastActiveAt: row.lastActiveAt,
    provider: (row.provider as SessionHistoryEntry['provider']) ?? 'codex',
    messageCount: row.messageCount,
    isPinned: row.isPinned,
    isHidden: row.isHidden,
  }
}

export async function listRemoteSessionsForProject(
  projectKey: string,
  projectId: string,
): Promise<SessionHistoryEntry[]> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote || !projectId) return []
  const rows = await window.environment.listSessions(remote.connectionId, projectId)
  return rows.map(mapNodeRowToHistoryEntry)
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
  const messages = transcriptToChatMessages(snap?.transcript, providerId)
  const base = previous ?? createDefaultPerSessionState()
  const pendingPerm = nodePendingToPermissionRequest(snap?.pendingInteraction)
  const chatProvider = (providerId === 'claude' || providerId === 'codex'
    ? providerId
    : 'codex') as ChatProvider
  return {
    ...base,
    // Preserve renderer model/effort selection across node re-hydrate (node has no model field yet).
    selectedModel: previous?.selectedModel ?? base.selectedModel,
    selectedEffort: previous?.selectedEffort ?? base.selectedEffort,
    sessionProvider: chatProvider,
    preferredProvider: chatProvider,
    messages,
    status: nodeStatusToAgentStatus(snap?.status),
    _title: snap?.title ?? base._title ?? null,
    awaitingAssistantReply: snap?.status === 'streaming',
    pendingPermissions: pendingPerm ? [pendingPerm] : [],
    _historyHydrated: true,
  }
}

export async function createRemoteSession(
  projectKey: string,
  projectId: string,
  title?: string,
  opts?: { harnessId?: string; providerId?: string },
): Promise<{ sessionId: string; entry: SessionHistoryEntry }> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) throw new Error('not a remote project key')
  const harnessId = opts?.harnessId ?? 'codex'
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
 * Opening a remote project used to mint a renderer-only draft UUID via
 * `ensureSession` / `createSessionId`. That id never hits the CLI session
 * registry, so `session.send` returns "session not found". Prefer the
 * candidate when `session.get` succeeds; otherwise create a real node session.
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

  const wantHarness = opts?.harnessId ?? 'codex'

  if (candidateSessionId) {
    try {
      const snap = (await window.environment.getSession(
        remote.connectionId,
        candidateSessionId,
      )) as NodeSessionSnapshot | null
      if (snap && (snap.sessionId === candidateSessionId || snap.sessionId)) {
        const snapHarness = String(snap.harnessId || snap.providerId || '').toLowerCase()
        // Reuse only when harness matches the UI tab (or snap has no harness field).
        // A prior codex node session must not swallow a Claude-tab send.
        if (!snapHarness || snapHarness === wantHarness) {
          return { sessionId: candidateSessionId, created: false }
        }
        // Wrong harness — fall through to create.
      }
    } catch {
      // Missing / revoked / transport — create a fresh node session below.
    }
  }

  const created = await window.environment.createSession(remote.connectionId, {
    projectId,
    harnessId: wantHarness,
    providerId: opts?.providerId ?? wantHarness,
  })
  return { sessionId: created.sessionId, created: true }
}

/** Build a mapper scoped to a remote project key + node session id. */
export function createRemoteSessionEventMapper(
  projectKey: string,
  sessionId: string,
  providerId = 'codex',
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
  providerId = 'codex',
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
