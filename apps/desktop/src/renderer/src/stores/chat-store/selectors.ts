import type {
  AccountInfo,
  AgentInfo,
  ClaudeResources,
  CodexResources,
  ModelOption,
  SkillInfo,
  SlashCommandInfo,
} from '@superone/shared/agent-types'

import { isRemoteSession, useChatStore } from './index'
import { useSessionScope, type SessionScope } from './session-scope'
import type { ActiveSessionView, ChatStore, PerSessionState, ProjectState } from './types'
import { createDefaultPerSessionState, createDefaultProjectState } from './defaults'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

const DEFAULT_PER_SESSION = createDefaultPerSessionState()
const DEFAULT_PROJECT = createDefaultProjectState()
const DEFAULT_VIEW: ActiveSessionView = { ...DEFAULT_PER_SESSION, ...DEFAULT_PROJECT }

interface CachedView {
  project: ProjectState
  session: PerSessionState
  view: ActiveSessionView
}

const VIEW_CACHE_LIMIT = 32
const viewCache = new Map<string, CachedView>()

function mergedView(key: string, project: ProjectState, session: PerSessionState): ActiveSessionView {
  let cached = viewCache.get(key)
  if (!cached || cached.project !== project || cached.session !== session) {
    if (viewCache.size >= VIEW_CACHE_LIMIT) viewCache.clear()
    // Session fields must win over project (e.g. preferredProvider/sessionProvider).
    cached = { project, session, view: { ...project, ...session } }
    viewCache.set(key, cached)
  }
  return cached.view
}

export function useActiveSession<T>(selector: (s: ActiveSessionView) => T): T {
  const scope = useSessionScope()
  return useChatStore((store) => {
    const projectPath = scope?.projectPath ?? store.activeProject
    const project = projectPath ? store.projectSessions[projectPath] : null
    if (!project) return selector(DEFAULT_VIEW)
    const sessionId = scope?.sessionId ?? project._activeSessionId
    const session = (sessionId ? project._sessions[sessionId] : null) ?? DEFAULT_PER_SESSION
    return selector(mergedView(`${projectPath}${sessionId}`, project, session))
  })
}

// Non-reactive read of the active session view. Use when a component subscribes to a cheap
// derived signal (not the whole messages array) but needs the full view to compute on change.
export function getActiveSessionView(scope: SessionScope | null): ActiveSessionView {
  const store = useChatStore.getState()
  const projectPath = scope?.projectPath ?? store.activeProject
  const project = projectPath ? store.projectSessions[projectPath] : null
  if (!project) return DEFAULT_VIEW
  const sessionId = scope?.sessionId ?? project._activeSessionId
  const session = (sessionId ? project._sessions[sessionId] : null) ?? DEFAULT_PER_SESSION
  return mergedView(`${projectPath} ${sessionId}`, project, session)
}

export function useIsRemoteLocked(): boolean {
  const scope = useSessionScope()
  return useChatStore((store) => {
    const projectPath = scope?.projectPath ?? store.activeProject
    if (!projectPath) return false
    const project = store.projectSessions[projectPath]
    const sessionId = scope?.sessionId ?? project?._activeSessionId
    return isRemoteSession(store, projectPath, sessionId)
  })
}

export function useBashOutput(toolUseId: string): { content: string; finished: boolean; outputPath?: string } | undefined {
  return useChatStore((s) => s._bashOutputs[toolUseId])
}

export function useShareProgress(path: string): { loaded: number; total: number } | undefined {
  return useChatStore((s) => s._shareProgress[path])
}

const EMPTY_ACCOUNT: AccountInfo = {}
const EMPTY_MODELS: ModelOption[] = []
const EMPTY_SLASH_COMMANDS: SlashCommandInfo[] = []
const EMPTY_AGENTS: AgentInfo[] = []
const EMPTY_OUTPUT_STYLES: string[] = []
const EMPTY_SKILL_INFOS: SkillInfo[] = []

export const selectClaudeResources = (s: ChatStore): ClaudeResources | null => s.harnessResources.claude
export const selectCodexResources = (s: ChatStore): CodexResources | null => s.harnessResources.codex
/** Claude models: remote projects use node catalog on ProjectState; local uses desktop harness cache. */
export const selectClaudeModels = (s: ChatStore): ModelOption[] => {
  const path = s.activeProject
  if (path && parseRemoteProjectKey(path)) {
    return s.projectSessions[path]?.claudeModels ?? EMPTY_MODELS
  }
  return s.harnessResources.claude?.models ?? EMPTY_MODELS
}
export const selectCodexModels = (s: ChatStore): ModelOption[] => {
  const path = s.activeProject
  if (path && parseRemoteProjectKey(path)) {
    return s.projectSessions[path]?.codexModels ?? EMPTY_MODELS
  }
  return s.harnessResources.codex?.models ?? EMPTY_MODELS
}
export const selectCodexPrompts = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.codex?.prompts ?? EMPTY_SLASH_COMMANDS
export const selectActiveCodexSkills = (s: ChatStore): SkillInfo[] => {
  if (!s.activeProject) return EMPTY_SKILL_INFOS
  return s.projectSessions[s.activeProject]?._codexSkills ?? EMPTY_SKILL_INFOS
}
export const selectActiveCursorSlashItems = (s: ChatStore): SlashCommandInfo[] => {
  if (!s.activeProject) return EMPTY_SLASH_COMMANDS
  return s.projectSessions[s.activeProject]?._cursorSlashItems ?? EMPTY_SLASH_COMMANDS
}
export const selectClaudeAccount = (s: ChatStore): AccountInfo => s.harnessResources.claude?.account ?? EMPTY_ACCOUNT
export const selectClaudeSlashCommands = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.slashCommands ?? EMPTY_SLASH_COMMANDS
export const selectClaudeSkills = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.skills ?? EMPTY_SLASH_COMMANDS
export const selectClaudeCommands = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.commands ?? EMPTY_SLASH_COMMANDS
export const selectClaudeAgents = (s: ChatStore): AgentInfo[] => s.harnessResources.claude?.agents ?? EMPTY_AGENTS
export const selectClaudeOutputStyles = (s: ChatStore): string[] => s.harnessResources.claude?.outputStyles ?? EMPTY_OUTPUT_STYLES
