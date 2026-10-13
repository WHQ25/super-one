import type { AgentPrewarmHint, ModelOption, PermissionMode } from '@superone/shared/agent-types'
import type { SessionSendRequest, SessionSettingsPatch } from '@superone/shared/environment/session-requests'
import type { ChatStore, PerSessionState, ProjectState, SessionWriteTarget } from '@/stores/chat-store/types'
import type { ChatStoreSet } from '@/stores/chat-store/helpers/lifecycle'

/** A session's model/effort pick, in harness-neutral terms. */
export interface SelectionState {
  model: string
  effort?: string
  modelUserChosen: boolean
  effortUserChosen: boolean
}

/**
 * Where a harness keeps its model/effort pick. Codex keeps its own pair of
 * fields (the wire and persistence carry them); every other harness uses the
 * neutral `selectedModel` / `selectedEffort`.
 */
export interface SelectionAccess {
  read(session: PerSessionState): SelectionState
  /**
   * The patch that writes a pick. Only the flags passed are written, so a
   * default refresh (`modelUserChosen: false`) and a restore that must not
   * claim a user choice stay distinguishable from a manual pick.
   */
  patch(
    change: { model?: string | null; effort?: string | null },
    flags?: { modelUserChosen?: boolean; effortUserChosen?: boolean },
  ): Partial<PerSessionState>
}

/** Context for seeding a new or switched-to session. */
export interface SeedContext {
  state: ChatStore
  project: ProjectState
  /** Claude catalog for this project: the node's for a remote project, else the desktop cache. */
  claudeModels: ModelOption[]
  /** The session being replaced, whose picks a harness may carry over. */
  previousSession?: PerSessionState | null
}

export interface LiveRestoreInput {
  /** The session as it is now, or a default one when the store has none. */
  previous: PerSessionState
  /** The session the store holds now; absent for a session this renderer has not seen. */
  stored?: PerSessionState
  /** The session when the snapshot was requested. */
  atRequest?: PerSessionState
  /** Patch derived from the snapshot's UI settings. */
  fromUi: Partial<PerSessionState>
  /** The running pick main persisted in harness-neutral fields. */
  snapshot: { selectedModel?: string | null; selectedEffort?: string | null }
}

/**
 * Pure per-harness store behavior. No React and no component imports: the
 * chat store imports these, and must stay free of selector code.
 */
export interface HarnessStrategy {
  selection: SelectionAccess
  /** Writes the harness's own defaults onto a fresh session (new chat, worktree switch). */
  seed(session: PerSessionState, context: SeedContext): void
  /** Defaults a restored or switched-to session still lacks, as a patch. */
  missingDefaults(session: PerSessionState, project: ProjectState, claudeModels: ModelOption[]): Partial<PerSessionState>
  /**
   * Patch for the session restored from storage at startup, reconciling its
   * pick with the catalog this desktop already holds. Absent: `missingDefaults`.
   */
  restore?(session: PerSessionState, context: SeedContext): Partial<PerSessionState>
  /**
   * Live hydration of a host snapshot: fields to lay over the snapshot's UI
   * settings, and a pick the user made since the request (applied last, so it
   * wins). Absent: the UI settings already carry the harness's pick.
   */
  liveRestore?(input: LiveRestoreInput): { fromUi: Partial<PerSessionState>; newer?: Partial<PerSessionState> }
  /** What a prewarmed runtime should start with. */
  prewarmHint(session: PerSessionState): Pick<AgentPrewarmHint, 'model' | 'effort' | 'acpAgentId'>
  /** The model and effort a turn runs with. Absent: the selection as stored. */
  runModel?(session: PerSessionState, project: ProjectState): { model?: string; effort?: string }
  /** The harness's own fields of a turn. */
  turnSettings?(context: TurnContext): HostFields<SessionSendRequest>
  /**
   * Harness pickers a draft hands this desktop's host when its session is
   * created there. A node takes them with each turn instead.
   */
  draftSettings?(session: PerSessionState): Partial<SessionSettingsPatch>
  /** Draft selections every host accepts when creating a session. */
  portableDraftSettings?(session: PerSessionState): Partial<SessionSettingsPatch>
  /** Selections this desktop's host takes when it creates the session. */
  createSelections?(session: PerSessionState): { acpAgentId?: string }
  /**
   * Whether a send made while a turn runs waits behind it: `always`, only a
   * plain run (`runs`: Codex commands such as review go out at once), or never.
   * Steering a held message is a separate capability (`supportsQueuedSteer`).
   */
  queuePolicy: 'always' | 'runs' | 'never'
  /** The send itself marks the turn streaming, before the host reports it. */
  sendStartsStreaming?: boolean
  /** The permission modes the cycle shortcut steps through. Absent: Claude's cycle. */
  permissionCycle?: readonly PermissionMode[]
  /** The cycle shortcut for a harness whose cycle is not permission modes. */
  cyclePermission?(context: InteractionContext): void
  /** The plan shortcut. Absent: the cycle shortcut. */
  togglePlan?(context: InteractionContext): void
  /** Whether the session is in this harness's plan mode. Absent: permission mode `plan`. */
  inPlanMode?(session: PlanModeFields): boolean
  slash: SlashPolicy
  /**
   * The model pick an empty draft takes when the user switches to this harness,
   * laid over the shared reset (ACP catalog, usage, goal).
   */
  resetFields(state: ChatStore, projectPath: string): Partial<PerSessionState>
  /** Loads and reconciles the harness's resources after a switch, then prewarms. */
  onSelect(context: SwitchContext): void
}

/** The active draft just switched to a harness. */
export interface SwitchContext {
  set: ChatStoreSet
  get: () => ChatStore
  projectPath: string
  /** The active session now. */
  session(): PerSessionState
  patch(update: Partial<PerSessionState>): void
  /** Whether the active session still runs this harness; the user may have switched on. */
  isCurrent(): boolean
  /** Prewarm once the prior harness's runtime for this draft is disposed. */
  prewarmAfterDispose(): Promise<void>
}

export type PlanModeFields = Pick<PerSessionState, 'permissionMode' | 'selectedCodexCollaborationMode' | 'openCodeAgentId'>

/**
 * How `/name` behaves, the same whether picked from the popup or typed and
 * sent. Every other command reaches the harness as turn text.
 */
export interface SlashPolicy {
  /**
   * Commands this desktop runs itself and never sends (keys of
   * `CLAUDE_INTERCEPTED_COMMANDS`). `workflows` also enables the `/workflow` picker.
   */
  hostCommands: readonly string[]
  /** Command names may contain spaces, and hidden commands are offered. */
  spacedCommands?: boolean
  /** `/plan` enters plan mode instead of being sent. */
  enterPlan?(store: ChatStore, target?: SessionWriteTarget): void
  /** `/review` opens the review panel. */
  reviewCommand?: boolean
  /** Picking a command with a prompt body writes the body into the composer. */
  expandsPromptBody?: boolean
  /** A typed command the harness runs over RPC instead of a turn; true when handled. */
  run?(name: string, context: SlashRunContext): Promise<boolean>
}

export interface SlashRunContext {
  session: PerSessionState
  projectPath: string
  sessionId: string | null
  patch(update: Partial<PerSessionState>): void
}

export interface InteractionContext {
  store: ChatStore
  session: PerSessionState
  target?: SessionWriteTarget
}

export interface TurnContext {
  state: ChatStore
  project: ProjectState
  /** The selections the turn runs with: the composer's choices across replay, else the session. */
  session: PerSessionState
  /** The session as the store holds it now; thread identity stays live. */
  current: PerSessionState
  turn: { turnKind?: SessionSendRequest['turnKind'] }
}

/**
 * Request fields split by host: `portable` reaches every host; `desktop` only
 * this desktop's host, which takes the harness pickers a node refuses.
 */
export interface HostFields<T> {
  portable?: Partial<T>
  desktop?: Partial<T>
}
