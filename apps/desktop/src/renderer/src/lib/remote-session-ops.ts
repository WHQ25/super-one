/**
 * Renderer helpers for remote-node session operations.
 * All host-scoped project keys use `remote:<connectionId>:<hostPath>`.
 */
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'
import { withCodexContents } from '@superone/shared/codex-content'
import type { SessionLoadResult } from '@superone/shared/environment'
import { hostPathsEqual, parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  nodeHarnessToProviderId,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'
import { createDefaultPerSessionState } from '@/stores/chat-store/defaults'
import type { ChatProvider, PerSessionState } from '@/stores/chat-store/types'

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
    ...(snap?.sessionId ? { hostSessionOwned: true, remoteControlReleased: snap.controlReleased === true, controlHolder: snap.controlHolder ?? null } : {}),
    ...(opts?.adoptSession ? {
      harnessUserChosen: true, modelUserChosen: !!snap?.model, effortUserChosen: !!snap?.effort,
      ...(snap?.permissionMode ? { permissionMode: snap.permissionMode } : {}),
      ...(snap?.sandboxMode ? { sandboxInfo: { enabled: snap.sandboxMode !== 'off', autoAllowBash: snap.sandboxMode === 'auto' } } : {}),
      apiProviderId: snap?.apiProviderId ?? null,
      cwd: snap?.cwd ?? remote.path,
      // The project root is not a worktree. Slash differences must not store a
      // bare host path that the file tree would read on this machine.
      _worktreePath: snap?.cwd && !hostPathsEqual(snap.cwd, remote.path) ? snap.cwd : null,
      ...(chatProvider === 'codex' ? {
        selectedCodexModel: snap?.model ?? '', selectedCodexReasoningEffort: (snap?.effort ?? undefined) as PerSessionState['selectedCodexReasoningEffort'],
        codexModelUserChosen: !!snap?.model, codexReasoningEffortUserChosen: !!snap?.effort,
      } : {}),
    } : {}),
    sessionProvider: chatProvider,
    preferredProvider: chatProvider,
    // Null from session.get means "this host did not name an agent", not
    // "replace the brand this window already has".
    ...(chatProvider === 'acp' && typeof snap?.acpAgentId === 'string' && snap.acpAgentId ? { acpAgentId: snap.acpAgentId } : {}),
    ...(snap ? { _parentSessionId: snap.parentSessionId ?? null } : {}),
    _title: snap?.title ?? base._title ?? null,
  }
}

/** Edges the desktop paints for a window read. A legacy load has none. */
export function remoteTranscriptEdges(
  loaded: Pick<SessionLoadResult, 'transcriptWindow' | 'summarized'>,
): PerSessionState['transcriptWindow'] {
  if (!loaded.transcriptWindow) return null
  return {
    older: loaded.transcriptWindow.older,
    newer: loaded.transcriptWindow.newer,
    total: loaded.transcriptWindow.total,
    ...(loaded.summarized ? { summarized: true as const } : {}),
  }
}

/** The fields of a node snapshot's state its event reducer derives; the rest stay the renderer's. */
const SNAPSHOT_STATE_KEYS = [
  'status', 'awaitingAssistantReply', 'lastAssistantMessageId',
  'pendingPermissions', 'pendingQuestion', 'pendingAsyncQuestions', 'pendingPlanApproval',
  'todos', 'showTodos', 'taskProgress', 'totalCostUsd', 'contextTokens', 'contextWindow',
] as const satisfies readonly (keyof PerSessionState)[]

/**
 * Catalogs the node snapshot already reduced (ACP `acp_models`, native
 * `session_agents`). Empty defaults from a cold reducer must not wipe a
 * catalog the renderer already holds.
 */
function catalogFromRemoteState(state: Partial<PerSessionState>): Partial<PerSessionState> {
  const patch: Partial<PerSessionState> = {}
  if (state.acpModels && state.acpModels.length > 0) {
    patch.acpModels = state.acpModels
    patch.acpModelsStatus = state.acpModelsStatus && state.acpModelsStatus !== 'idle' ? state.acpModelsStatus : 'ready'
    if (state.acpModelConfigId !== undefined) patch.acpModelConfigId = state.acpModelConfigId
    patch.acpModelsError = state.acpModelsError ?? null
  }
  if (state.acpModes && state.acpModes.length > 0) {
    patch.acpModes = state.acpModes
    patch.acpModesStatus = state.acpModesStatus && state.acpModesStatus !== 'idle' ? state.acpModesStatus : 'ready'
    if (state.acpModeConfigId !== undefined) patch.acpModeConfigId = state.acpModeConfigId
    if (state.selectedAcpModeId !== undefined) patch.selectedAcpModeId = state.selectedAcpModeId
  }
  if (state.sessionModels && state.sessionModels.length > 0) patch.sessionModels = state.sessionModels
  return patch
}

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
  // A session the host already owns starts its window read beside the row read.
  // A first adopt waits for the row, so the follow uses that harness, and a
  // draft the node has never seen does not open at all.
  const openInput = (providerId: string) => ({ sessionId, projectPath: projectKey, providerId, transcript: true as const })
  const openPromise = previous?.hostSessionOwned === true
    ? window.environment.openRemoteSession(remote.connectionId, openInput(previous.sessionProvider || previous.preferredProvider || 'claude'))
    : null
  // Observed now: if the row read throws first, nothing else awaits this read.
  void openPromise?.catch(() => {})
  const snap = (await window.environment.getSession(
    remote.connectionId,
    sessionId,
  )) as NodeSessionSnapshot | null
  const hydrated = applyRemoteSessionRow(remote, previous, snap, opts)
  // Draft session ids only exist in the renderer until first send.
  if (!snap?.sessionId) return { hydrated, snap }
  const loaded = await (openPromise ?? window.environment.openRemoteSession(
    remote.connectionId,
    openInput(hydrated.sessionProvider || hydrated.preferredProvider || 'claude'),
  ))
  const state = loaded.state as Partial<PerSessionState>
  const derived = Object.fromEntries(SNAPSHOT_STATE_KEYS.filter((key) => key in state).map((key) => [key, state[key]]))
  const catalog = catalogFromRemoteState(state)
  const provider = hydrated.sessionProvider || hydrated.preferredProvider
  if ((provider && HARNESS_CAPABILITIES[provider]?.supportsRealtimeVoice) || loaded.restore?.realtimeHasTimeline) {
    const { applySessionLoadRealtimeTimeline } = await import('@/stores/codex-realtime-view')
    applySessionLoadRealtimeTimeline(sessionId, loaded)
  }
  // Older pages are committed and never change: keep those already held.
  // A window read returns the whole held range and sets `before` null.
  const page = withCodexContents(loaded.messages)
  const first = loaded.before == null ? -1 : hydrated.messages.findIndex((message) => message.id === page[0]?.id)
  const messages = first > 0 ? [...hydrated.messages.slice(0, first), ...page] : page
  return {
    hydrated: {
      ...hydrated,
      ...derived,
      ...catalog,
      messages,
      _historyHydrated: true,
      transcriptWindow: remoteTranscriptEdges(loaded),
      transcriptResyncing: false,
    },
    snap,
  }
}

/**
 * Page a remote session's held window toward older or newer rows. The session
 * row and state are unchanged, so only the window is read: main returns the
 * whole held range with the page joined.
 */
export async function pageRemoteTranscript(
  projectKey: string,
  sessionId: string,
  session: Pick<PerSessionState, 'sessionProvider' | 'preferredProvider'>,
  page: { anchor: { messageId: string; key?: string }; direction: 'before' | 'after' },
): Promise<Pick<PerSessionState, 'messages' | 'transcriptWindow'> | null> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) return null
  const loaded = await window.environment.openRemoteSession(remote.connectionId, {
    sessionId,
    projectPath: projectKey,
    providerId: session.sessionProvider || session.preferredProvider || 'claude',
    transcript: true,
    anchor: page.anchor,
    direction: page.direction,
  })
  return { messages: withCodexContents(loaded.messages), transcriptWindow: remoteTranscriptEdges(loaded) }
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
    replyComments: current.replyComments,
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
