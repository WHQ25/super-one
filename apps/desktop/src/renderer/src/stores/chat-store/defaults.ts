import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { PerSessionState, ProjectState } from './types'
import { SUBAGENT_COLOR_POOL } from './types'

const SUBAGENT_COLOR_POOL_SIZE = SUBAGENT_COLOR_POOL.length

export function freshSubagentColorPool(): number[] {
  return Array.from({ length: SUBAGENT_COLOR_POOL_SIZE }, (_, i) => i)
}

/**
 * Generate a fresh session id. Shared with the main process 1:1 as
 * `Session.id`; no draft/promotion dance — the id assigned here is the
 * stable identity used in DB, IPC, and the main-process SessionManager.
 */
export function createSessionId(): string {
  return crypto.randomUUID()
}

export function createDefaultPerSessionState(): PerSessionState {
  return {
    ...createDefaultChatCoreSession(),
    _title: null,
    dshPreset: null,
    detailedUsage: null,
    subagentColors: {},
    _subagentColorsFree: freshSubagentColorPool(),
    cursorModelParams: {},
    chatInputFocusNonce: 0,
    chatInputRestoreFocusNonce: 0,
    harnessUserChosen: false,
    draftText: '',
    draftJson: null,
    draftId: null,
    attachments: [],
    browserAnnotations: [],
    mentions: [],
    _gitBranch: null,
    _worktreePath: null,
    additionalDirs: [],
    additionalDirsDirty: false,
    _remoteTurnQueue: [],
    activeCodexMessageId: null,
    miniAppContexts: {},
    userSelections: [],
    _historyHydrated: true,
  }
}

export function createDefaultProjectState(): ProjectState {
  return {
    _activeSessionId: null,
    _previousSessionId: null,
    _sessions: {},
    slashCommands: [],
    _projectSkills: [],
    _projectCommands: [],
    agents: [],
    homedir: '',
    sandboxInfo: { enabled: false, autoAllowBash: false },
    sessions: [],
    sessionsPage: 0,
    sessionsHasMore: true,
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    unseenCompletedSessions: new Set(),
    codexModels: [],
    codexModelsByProvider: {},
    codexModelsLoading: false,
    claudeModels: [],
    claudeModelsByProvider: {},
    claudeModelsLoading: false,
    _codexSkills: [],
    _codexSkillsLoading: false,
    _cursorSlashItems: [],
    _cursorSlashItemsLoading: false,
    projectExtraDirs: [],
    showDirManager: false,
    showReviewPanel: false,
    reviewPanelInitialMode: 'uncommitted',
  }
}

export function getDefaultEffortForModel(model?: ModelOption): EffortLevel | undefined {
  const levels = model?.supportedEffortLevels
  if (!levels?.length) return undefined
  if (levels.includes('high')) return 'high'
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}
