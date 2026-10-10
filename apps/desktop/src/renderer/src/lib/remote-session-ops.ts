/**
 * Renderer helpers for remote-node session operations.
 * All host-scoped project keys use `remote:<connectionId>:<hostPath>`.
 */
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  nodeHarnessToProviderId,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'
import { mapEnvironmentSessionRow } from '@/lib/session-list-ops'
import { createDefaultPerSessionState } from '@/stores/chat-store/defaults'
import type { ChatProvider, PerSessionState } from '@/stores/chat-store/types'

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

/**
 * The session's row on the node (settings, title, control) applied over
 * `previous`. Messages, status and interactions come from the snapshot
 * `hydrateRemoteSession` reads; a draft the node has never seen keeps its own.
 */
function applyRemoteSessionRow(
  remote: NonNullable<ReturnType<typeof parseRemoteProjectKey>>,
  previous: PerSessionState | null | undefined,
  snap: NodeSessionSnapshot | null,
  opts?: { adoptSession?: boolean },
): PerSessionState {
  const providerId = nodeHarnessToProviderId(snap?.harnessId || snap?.providerId)
  const base = previous ?? createDefaultPerSessionState()
  const chatProvider = (Object.hasOwn(HARNESS_CAPABILITIES, providerId)
    ? providerId
    : 'claude') as ChatProvider
  return {
    ...base,
    selectedModel: previous?.modelUserChosen ? previous.selectedModel : snap?.model ?? previous?.selectedModel ?? base.selectedModel,
    selectedEffort: previous?.effortUserChosen ? previous.selectedEffort : (snap?.effort as PerSessionState['selectedEffort']) ?? previous?.selectedEffort ?? base.selectedEffort,
    ...(snap?.sessionId ? { hostSessionOwned: true, remoteControlReleased: snap.controlReleased === true } : {}),
    ...(opts?.adoptSession ? {
      harnessUserChosen: true, modelUserChosen: !!snap?.model, effortUserChosen: !!snap?.effort,
      ...(snap?.permissionMode ? { permissionMode: snap.permissionMode } : {}),
      ...(snap?.sandboxMode ? { sandboxInfo: { enabled: snap.sandboxMode !== 'off', autoAllowBash: snap.sandboxMode === 'auto' } } : {}),
      apiProviderId: snap?.apiProviderId ?? null,
      cwd: snap?.cwd ?? remote.path,
      _worktreePath: snap?.cwd && snap.cwd !== remote.path ? snap.cwd : null,
      ...(chatProvider === 'codex' ? {
        selectedCodexModel: snap?.model ?? '', selectedCodexReasoningEffort: (snap?.effort ?? undefined) as PerSessionState['selectedCodexReasoningEffort'],
        codexModelUserChosen: !!snap?.model, codexReasoningEffortUserChosen: !!snap?.effort,
      } : {}),
    } : {}),
    sessionProvider: chatProvider,
    preferredProvider: chatProvider,
    ...(chatProvider === 'acp' && snap?.acpAgentId !== undefined ? { acpAgentId: snap.acpAgentId } : {}),
    _title: snap?.title ?? base._title ?? null,
  }
}

/** The fields of a node snapshot's state its event reducer derives; the rest stay the renderer's. */
const SNAPSHOT_STATE_KEYS = [
  'status', 'awaitingAssistantReply', 'lastAssistantMessageId',
  'pendingPermissions', 'pendingQuestion', 'pendingPlanApproval',
  'todos', 'showTodos', 'taskProgress', 'totalCostUsd', 'contextTokens', 'contextWindow',
] as const satisfies readonly (keyof PerSessionState)[]

/**
 * Open one remote session: `session.get` for its row and `openRemoteSession`
 * for its state and messages, which main reads as a snapshot while it starts
 * following the session. The snapshot replaces what the chat held: every event
 * above it reaches the chat after this resolves, and one it already holds is
 * skipped by message `seq`.
 *
 * Returns the raw row too, so callers can drive `followRemoteSessionEvents`
 * off node truth instead of the (possibly stale) in-memory session state.
 */
export async function hydrateRemoteSession(
  projectKey: string,
  sessionId: string,
  previous?: PerSessionState | null,
  opts?: { adoptSession?: boolean },
): Promise<{ hydrated: PerSessionState; snap: NodeSessionSnapshot | null }> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) {
    return { hydrated: previous ?? createDefaultPerSessionState(), snap: null }
  }
  const snap = (await window.environment.getSession(
    remote.connectionId,
    sessionId,
  )) as NodeSessionSnapshot | null
  const hydrated = applyRemoteSessionRow(remote, previous, snap, opts)
  // Draft session ids only exist in the renderer until first send.
  if (!snap?.sessionId) return { hydrated, snap }
  const loaded = await window.environment.openRemoteSession(remote.connectionId, {
    sessionId,
    projectPath: projectKey,
    providerId: hydrated.sessionProvider || hydrated.preferredProvider || 'claude',
    limit: 200,
  })
  const state = loaded.state as Partial<PerSessionState>
  const derived = Object.fromEntries(SNAPSHOT_STATE_KEYS.filter((key) => key in state).map((key) => [key, state[key]]))
  // Older pages are committed and never change: keep those already held.
  const first = loaded.before == null ? -1 : hydrated.messages.findIndex((message) => message.id === loaded.messages[0]?.id)
  const messages = first > 0 ? [...hydrated.messages.slice(0, first), ...loaded.messages] : loaded.messages
  return { hydrated: { ...hydrated, ...derived, messages, _historyHydrated: true }, snap }
}

/** A hydrated session with the composer and queue the renderer owns kept from `current`. */
export function keepRendererOwnedState(
  current: PerSessionState | null | undefined,
  hydrated: PerSessionState,
): PerSessionState {
  if (!current) return hydrated
  return {
    ...hydrated,
    draftText: current.draftText,
    draftJson: current.draftJson,
    draftId: current.draftId,
    attachments: current.attachments,
    mentions: current.mentions,
    browserAnnotations: current.browserAnnotations,
    queuedMessages: current.queuedMessages,
    // Both halves of the same fact: the ghost text and the alternatives beside it.
    // Carrying only one leaves the composer showing half a suggestion set.
    promptSuggestion: current.promptSuggestion,
    promptSuggestions: current.promptSuggestions,
  }
}

/**
 * After hydrate/focus: follow the node session so every later event reaches
 * handleAgentEvent — a running turn, and turns another client starts while it
 * sits idle here. Main keeps one follower per session.
 */
export function followRemoteSessionEvents(
  projectKey: string,
  sessionId: string,
  sess: Pick<PerSessionState, 'sessionProvider' | 'preferredProvider'>,
  snap?: NodeSessionSnapshot | null,
): void {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote || !sessionId) return
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
    entry: mapEnvironmentSessionRow({
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
