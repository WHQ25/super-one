import { remoteProjectKey, parseRemoteProjectKey } from '@/lib/remote-project-key'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'
import type { DraftSessionSettings } from '@superone/shared/environment'
import type {
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  EffortLevel,
  ImageAttachment,
  PermissionMode,
} from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/session-types'
import { environmentIdForProjectKey, selectionFromDraftFields } from '@superone/shared/session-location'
import type { NewSessionWorktreeSelection } from '@superone/shared/session-location'
import { useAppStore } from '../../app'
import type { ChatProvider, ChatStore, PerSessionState, ProjectState } from '../types'
import { useChatStore } from '../index'
import { isUnsentSession } from './session-liveness'
import { logWorktreeWrite } from '@superone/shared/session-worktree-log'

export function hasDraftContent(session: PerSessionState | undefined): boolean {
  return !!session && hasPersistableDraftContent({ text: session.draftText, docJson: session.draftJson, attachments: session.attachments })
}

export function resolveDraftTarget(projectPath: string): {
  connectionId: string
  projectPath: string
} {
  const remote = parseRemoteProjectKey(projectPath)
  return remote
    ? { connectionId: remote.connectionId, projectPath: remote.path }
    : { connectionId: 'local', projectPath }
}

export function draftProjectKey(connectionId: string, projectPath: string | null): string | null {
  if (!projectPath) return null
  return connectionId === 'local' ? projectPath : remoteProjectKey(connectionId, projectPath)
}

export interface ParkedDraftSnapshot {
  draftId: string
  projectPath: string
  sessionId: string
  session: PerSessionState
  sandboxInfo: ProjectState['sandboxInfo'] | null
}

export interface WorktreeHint {
  path: string | null
  branch?: string | null
  pendingBaseBranch?: string | null
  pendingMode?: string | null
  pendingBranchName?: string | null
  pendingCarryLocalChanges?: boolean
}

export interface OpenDraftCarry {
  draftId: string | null
  fromProject: string
  fromSessionId: string
  text: string
  docJson: object | null
  attachments: ImageAttachment[]
  settings: DraftSessionSettings
}

export function emptyDraftFields(): Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments' | 'draftId' | 'draftRemoteDeviceId'> {
  return { draftText: '', draftJson: null, attachments: [], draftId: null, draftRemoteDeviceId: null }
}

const parkedByDraftId = new Map<string, ParkedDraftSnapshot>()

function cloneSession(session: PerSessionState): PerSessionState {
  return {
    ...session,
    attachments: session.attachments.map((a) => ({ ...a })),
    additionalDirs: [...(session.additionalDirs ?? [])],
    messages: [],
  }
}

export function getParkedDraft(draftId: string): ParkedDraftSnapshot | undefined {
  return parkedByDraftId.get(draftId)
}

export function parkDraftSnapshot(snapshot: ParkedDraftSnapshot): void {
  parkedByDraftId.set(snapshot.draftId, {
    ...snapshot,
    session: cloneSession(snapshot.session),
  })
}

export function releaseParkedDraft(draftId: string): void {
  parkedByDraftId.delete(draftId)
}

export function clearParkedDraftMap(): void {
  parkedByDraftId.clear()
}

export function isDraftOwnedBySession(
  draft: { id: string; originSessionId: string | null },
  sessionId: string | null | undefined,
  sessionDraftId?: string | null,
): boolean {
  if (!sessionId) return false
  if (sessionDraftId && sessionDraftId === draft.id) return true
  return !!draft.originSessionId && draft.originSessionId === sessionId
}

export function hintFromSession(session: PerSessionState): WorktreeHint | null {
  const owned = session.environmentSelection
  if (owned?.selection.kind === 'create') {
    return {
      path: session._worktreePath ?? null,
      branch: session._gitBranch ?? null,
      pendingBaseBranch: owned.selection.baseBranch,
      pendingMode: owned.selection.mode,
      pendingBranchName: owned.selection.branchName,
      pendingCarryLocalChanges: owned.selection.carryLocalChanges,
    }
  }
  if (owned?.selection.kind === 'existing') {
    return {
      path: session._worktreePath ?? owned.selection.path,
      branch: session._gitBranch ?? owned.selection.branch ?? null,
    }
  }
  if (session._worktreePath || session._gitBranch) {
    return { path: session._worktreePath ?? null, branch: session._gitBranch ?? null }
  }
  return null
}

export function snapshotDraftSettings(
  session: PerSessionState,
  project?: ProjectState | null,
  worktree?: WorktreeHint | null,
): DraftSessionSettings {
  const harness = (session.sessionProvider ?? session.preferredProvider) as HarnessId
  const model = session.selectedModel || null
  const effort = session.selectedEffort ?? null
  const codexModel = session.selectedCodexModel || null
  const codexEffort = session.selectedCodexReasoningEffort ?? null
  const owned = session.environmentSelection ?? null
  const experiment = useAppStore.getState().experimentalRemoteNodesEnabled === true
  const worktreePath = experiment
    ? (session._worktreePath ?? null)
    : (session._worktreePath ?? worktree?.path ?? null)
  const gitBranch = experiment
    ? (session._gitBranch ?? null)
    : (session._gitBranch ?? worktree?.branch ?? null)
  const create = experiment && owned?.selection.kind === 'create' ? owned.selection : null
  const pendingFromHint = !experiment || !owned
  const worktreeSelection: NewSessionWorktreeSelection | null = (experiment ? owned?.selection : null)
    ?? (worktreePath
      ? { kind: 'existing', path: worktreePath, ...(gitBranch ? { branch: gitBranch } : {}) }
      : null)

  return {
    harness,
    harnessUserChosen: session.harnessUserChosen,
    model,
    effort,
    modelUserChosen: session.modelUserChosen || !!model,
    effortUserChosen: session.effortUserChosen || !!effort,
    codexModel,
    codexReasoningEffort: codexEffort,
    codexServiceTier: session.selectedCodexServiceTier,
    claudeFastMode: session.claudeFastMode,
    codexModelUserChosen: session.codexModelUserChosen || !!codexModel,
    codexReasoningEffortUserChosen: session.codexReasoningEffortUserChosen || !!codexEffort,
    codexPermissionPreset: session.selectedCodexPermissionPreset,
    codexCollaborationMode: session.selectedCodexCollaborationMode,
    permissionMode: session.permissionMode,
    acpAgentId: session.acpAgentId,
    openCodeAgentId: session.openCodeAgentId,
    selectedAcpModeId: session.selectedAcpModeId,
    apiProviderId: session.apiProviderId,
    worktreePath,
    gitBranch,
    environmentId: owned?.environmentId ?? null,
    worktreeSelection,
    pendingBaseBranch: create ? create.baseBranch : pendingFromHint ? (worktree?.pendingBaseBranch ?? null) : null,
    pendingWorktreeMode: create ? create.mode : pendingFromHint ? (worktree?.pendingMode ?? null) : null,
    pendingBranchName: create ? create.branchName : pendingFromHint ? (worktree?.pendingBranchName ?? null) : null,
    pendingCarryLocalChanges: create
      ? create.carryLocalChanges
      : pendingFromHint ? !!worktree?.pendingCarryLocalChanges : false,
    sandboxEnabled: project?.sandboxInfo?.enabled,
    sandboxAutoAllowBash: project?.sandboxInfo?.autoAllowBash,
    additionalDirs: session.additionalDirs?.length ? [...session.additionalDirs] : [],
    ...(session.continuesFrom ? { continuesFrom: session.continuesFrom } : {}),
  }
}

export function sessionFieldsFromSettings(
  settings: DraftSessionSettings | null | undefined,
): Partial<PerSessionState> {
  if (!settings) return {}
  const patch: Partial<PerSessionState> = {}
  if (settings.harness) {
    patch.preferredProvider = settings.harness as ChatProvider
    patch.sessionProvider = settings.harness as ChatProvider
  }
  if (settings.harnessUserChosen !== undefined) {
    patch.harnessUserChosen = settings.harnessUserChosen
  }
  if (settings.model != null && settings.model !== '') {
    patch.selectedModel = settings.model
    patch.modelUserChosen = true
  }
  if (settings.effort != null && settings.effort !== '') {
    patch.selectedEffort = settings.effort as EffortLevel
    patch.effortUserChosen = true
  }
  if (settings.codexModel != null && settings.codexModel !== '') {
    patch.selectedCodexModel = settings.codexModel
    patch.codexModelUserChosen = true
  }
  if (settings.codexReasoningEffort != null && settings.codexReasoningEffort !== '') {
    patch.selectedCodexReasoningEffort = settings.codexReasoningEffort as CodexReasoningEffort
    patch.codexReasoningEffortUserChosen = true
  }
  if (settings.claudeFastMode !== undefined) patch.claudeFastMode = settings.claudeFastMode
  if (settings.codexServiceTier !== undefined) {
    patch.selectedCodexServiceTier = settings.codexServiceTier
  }
  if (settings.codexPermissionPreset) {
    patch.selectedCodexPermissionPreset = settings.codexPermissionPreset as CodexPermissionPreset
  }
  if (settings.codexCollaborationMode) {
    patch.selectedCodexCollaborationMode =
      settings.codexCollaborationMode as CodexCollaborationMode
  }
  if (settings.permissionMode) {
    patch.permissionMode = settings.permissionMode as PermissionMode
  }
  if (settings.acpAgentId !== undefined) patch.acpAgentId = settings.acpAgentId
  if (settings.openCodeAgentId !== undefined) patch.openCodeAgentId = settings.openCodeAgentId
  if (settings.selectedAcpModeId !== undefined) {
    patch.selectedAcpModeId = settings.selectedAcpModeId
  }
  if (settings.apiProviderId !== undefined) patch.apiProviderId = settings.apiProviderId
  if (settings.worktreePath !== undefined) {
    patch._worktreePath = settings.worktreePath
    logWorktreeWrite('sessionFieldsFromSettings', {
      projectPath: null,
      sessionId: null,
      before: null,
      after: settings.worktreePath,
      unsent: true,
    })
  }
  if (settings.gitBranch !== undefined) patch._gitBranch = settings.gitBranch
  const owned = selectionFromDraftFields(settings)
  if (owned) patch.environmentSelection = owned
  if (settings.additionalDirs) {
    patch.additionalDirs = [...settings.additionalDirs]
    patch.additionalDirsDirty = settings.additionalDirs.length > 0
  }
  if (settings.continuesFrom) patch.continuesFrom = settings.continuesFrom
  return patch
}

export function applyDraftWorktreeUi(
  projectPath: string,
  settings: DraftSessionSettings | null | undefined,
): void {
  const nextPath = settings?.worktreePath ?? null
  logWorktreeWrite('applyDraftWorktreeUi', {
    projectPath,
    sessionId: useChatStore.getState().projectSessions[projectPath]?._activeSessionId ?? null,
    before: useAppStore.getState()._worktrees[projectPath]?.activePath ?? null,
    after: nextPath,
    unsent: true,
  })
  useAppStore.setState({
    _worktrees: {
      ...useAppStore.getState()._worktrees,
      [projectPath]: {
        pendingBaseBranch: settings?.pendingBaseBranch ?? null,
        pendingMode: (settings?.pendingWorktreeMode as 'branch' | 'attach' | 'detach' | undefined) ?? 'branch',
        pendingBranchName: settings?.pendingBranchName ?? '',
        pendingCarryLocalChanges: !!settings?.pendingCarryLocalChanges,
        activePath: nextPath,
      },
    },
  })
}

export function projectSandboxFromSettings(
  settings: DraftSessionSettings | null | undefined,
): ProjectState['sandboxInfo'] | null {
  if (!settings || settings.sandboxEnabled === undefined) return null
  return {
    enabled: !!settings.sandboxEnabled,
    autoAllowBash: !!settings.sandboxAutoAllowBash,
  }
}

function carriedSettings(
  settings: DraftSessionSettings,
  crossProject: boolean,
  toProject: string,
): DraftSessionSettings {
  if (!crossProject) return settings
  return {
    ...settings,
    worktreePath: null,
    pendingBaseBranch: null,
    pendingWorktreeMode: null,
    pendingBranchName: null,
    pendingCarryLocalChanges: false,
    environmentId: environmentIdForProjectKey(toProject),
    worktreeSelection: { kind: 'local' },
  }
}

function contentAndSettingsFields(
  carried: OpenDraftCarry,
  toProject: string,
): Partial<PerSessionState> {
  const settings = carriedSettings(carried.settings, carried.fromProject !== toProject, toProject)
  return {
    draftText: carried.text,
    draftJson: carried.docJson,
    attachments: carried.attachments,
    draftId: carried.draftId,
    sandboxInfo: undefined,
    ...sessionFieldsFromSettings(settings),
  }
}

export function computeCarriedDraftSessions(
  projectSessions: ChatStore['projectSessions'],
  toProject: string,
  carried: OpenDraftCarry,
): { projectSessions: ChatStore['projectSessions']; toSessionId: string } {
  const fromProj = projectSessions[carried.fromProject]
  const toProj = projectSessions[toProject]
  if (!toProj) return { projectSessions, toSessionId: '' }

  const settingsForDest = carriedSettings(carried.settings, carried.fromProject !== toProject, toProject)
  const sandbox = projectSandboxFromSettings(settingsForDest)
  const nextSessions = { ...projectSessions }

  if (fromProj?._sessions[carried.fromSessionId]) {
    const src = fromProj._sessions[carried.fromSessionId]!
    nextSessions[carried.fromProject] = {
      ...fromProj,
      _sessions: {
        ...fromProj._sessions,
        [carried.fromSessionId]: { ...src, ...emptyDraftFields() },
      },
    }
  }

  const dest = nextSessions[toProject] ?? toProj
  const activeSid = dest._activeSessionId
  const active = activeSid ? dest._sessions[activeSid] : undefined
  const fields = contentAndSettingsFields(
    { ...carried, settings: settingsForDest },
    toProject,
  )
  const destWithSandbox = sandbox
    ? { ...dest, sandboxInfo: sandbox }
    : dest

  if (activeSid && isUnsentSession(active)) {
    nextSessions[toProject] = {
      ...destWithSandbox,
      _sessions: {
        ...dest._sessions,
        [activeSid]: { ...active!, ...fields },
      },
    }
    return { projectSessions: nextSessions, toSessionId: activeSid }
  }

  const newSid = crypto.randomUUID()
  const template = active ?? Object.values(dest._sessions)[0]
  const base = template
    ? {
        ...template,
        _historyHydrated: true,
        hostSessionOwned: false,
        _providerSessionId: null,
        contextTokens: 0,
        contextWindow: null,
        detailedUsage: null,
        totalCostUsd: 0,
        rateLimitInfo: null,
        apiRetry: null,
        queuedMessages: [],
        messages: [],
        status: 'idle' as const,
        awaitingAssistantReply: false,
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
        session: null,
        ...emptyDraftFields(),
        cwd: toProject,
      }
    : ({
        _historyHydrated: true,
        cwd: toProject,
        messages: [],
        status: 'idle',
        awaitingAssistantReply: false,
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
        ...emptyDraftFields(),
      } as unknown as PerSessionState)

  nextSessions[toProject] = {
    ...destWithSandbox,
    _activeSessionId: newSid,
    _sessions: {
      ...dest._sessions,
      [newSid]: { ...base, ...fields },
    },
  }

  return { projectSessions: nextSessions, toSessionId: newSid }
}
