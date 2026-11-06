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
  const namedHarness = snap?.harnessId || snap?.providerId
  const providerId = namedHarness ? nodeHarnessToProviderId(namedHarness) : null
  const base = previous ?? createDefaultPerSessionState()
  // A draft the node has never seen keeps the harness this window already picked.
  // Forcing Claude here is what snapped a Grok click back before the first send.
  const fallbackProvider = previous?.sessionProvider ?? previous?.preferredProvider ?? 'claude'
  const chatProvider = (providerId && Object.hasOwn(HARNESS_CAPABILITIES, providerId)
    ? providerId
    : fallbackProvider) as ChatProvider
  return {
    ...base,
    selectedModel: previous?.modelUserChosen ? previous.selectedModel : snap?.model ?? previous?.selectedModel ?? base.selectedModel,
    selectedEffort: previous?.effortUserChosen ? previous.selectedEffort : (snap?.effort as PerSessionState['selectedEffort']) ?? previous?.selectedEffort ?? base.selectedEffort,
    ...(snap?.sessionId ? { hostSessionOwned: true, remoteControlReleased: snap.controlReleased === true, controlHolder: snap.controlHolder ?? null } : {}),
    ...(opts?.adoptSession ? {
      harnessUserChosen: true,
      modelUserChosen: !!previous?.modelUserChosen || !!snap?.model,
      effortUserChosen: !!previous?.effortUserChosen || !!snap?.effort,
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
  'runtimeCapabilities',
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
  // The window read starts beside the row read for a session this desktop
  // already follows and for a first adopt. The follow learns the harness from
  // the window state if the row has not arrived yet. A draft the node has
  // never seen (not an adopt, not already owned here) does not open.
  const openInput = (providerId: string) => ({ sessionId, projectPath: projectKey, providerId, transcript: true as const })
  const openPromise = opts?.adoptSession === true || previous?.hostSessionOwned === true
    ? window.environment.openRemoteSession(
        remote.connectionId,
        openInput(previous?.sessionProvider || previous?.preferredProvider || 'claude'),
      )
    : null
  // Observed now: if the row read throws first, nothing else awaits this read.
  void openPromise?.catch(() => {})
  const snap = (await window.environment.getSession(
    remote.connectionId,
    sessionId,
  )) as NodeSessionSnapshot | null
  const hydrated = applyRemoteSessionRow(remote, previous, snap, opts)
  // Draft session ids only exist in the renderer until first send. An adopt
  // that raced the window read abandons it when the node has no such row.
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
  const localQueue = new Map((hydrated.queuedMessages ?? []).map(message => [message.id, message]))
  return {
    hydrated: {
      ...hydrated,
      ...derived,
      ...catalog,
      messages,
      queuedMessages: state.queuedMessages?.map(message => localQueue.get(message.id) ?? message) ?? hydrated.queuedMessages,
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

/** Keep the composer and queue changes made while the host snapshot was loading. */
export function keepRendererOwnedState(
  current: PerSessionState | null | undefined,
  hydrated: PerSessionState,
  atRequest?: PerSessionState | null,
): PerSessionState {
  if (!current) return hydrated
  // An empty draft's harness click can land while this read is in flight.
  // The node row is still the previous harness; do not paint that back over
  // a conversation that has no messages on either side.
  const pendingHarness = current.harnessUserChosen
    && (current.messages?.length ?? 0) === 0
    && (hydrated.messages?.length ?? 0) === 0
    && !!current.sessionProvider
    && current.sessionProvider !== hydrated.sessionProvider
  return {
    ...hydrated,
    ...(pendingHarness ? {
      sessionProvider: current.sessionProvider,
      preferredProvider: current.preferredProvider,
      acpAgentId: current.acpAgentId,
      harnessUserChosen: true,
    } : {}),
    draftText: current.draftText,
    draftJson: current.draftJson,
    draftId: current.draftId,
    attachments: current.attachments,
    mentions: current.mentions,
    browserAnnotations: current.browserAnnotations,
    replyComments: current.replyComments,
    queuedMessages: atRequest && current.queuedMessages !== atRequest.queuedMessages
      ? current.queuedMessages
      : hydrated.queuedMessages.map(message => current.queuedMessages.find(local => local.id === message.id) ?? message),
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
