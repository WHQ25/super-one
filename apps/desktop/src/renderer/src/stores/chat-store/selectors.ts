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
import type { ActiveSessionView, ChatStore, PerSessionState, ProjectState } from './types'
import { createDefaultPerSessionState, createDefaultProjectState } from './defaults'

const DEFAULT_PER_SESSION = createDefaultPerSessionState()
const DEFAULT_PROJECT = createDefaultProjectState()
const DEFAULT_VIEW: ActiveSessionView = { ...DEFAULT_PER_SESSION, ...DEFAULT_PROJECT }

let _cachedProject: ProjectState | null = null
let _cachedSession: PerSessionState | null = null
let _cachedView: ActiveSessionView | null = null

export function useActiveSession<T>(selector: (s: ActiveSessionView) => T): T {
  return useChatStore((store) => {
    const project = store.activeProject
      ? store.projectSessions[store.activeProject]
      : null
    const p = project ?? DEFAULT_PROJECT
    const session = (p._activeSessionId ? p._sessions[p._activeSessionId] : null) ?? DEFAULT_PER_SESSION
    if (!project) return selector(DEFAULT_VIEW)
    if (p !== _cachedProject || session !== _cachedSession) {
      _cachedProject = p
      _cachedSession = session
      _cachedView = { ...session, ...p }
    }
    return selector(_cachedView!)
  })
}

export function useIsRemoteLocked(): boolean {
  return useChatStore((store) => {
    if (!store.activeProject) return false
    const project = store.projectSessions[store.activeProject]
    return isRemoteSession(store, store.activeProject, project?._activeSessionId)
  })
}

export function useBashOutput(toolUseId: string): { content: string; finished: boolean; outputPath?: string } | undefined {
  return useChatStore((s) => s._bashOutputs[toolUseId])
}

const EMPTY_ACCOUNT: AccountInfo = {}
const EMPTY_MODELS: ModelOption[] = []
const EMPTY_SLASH_COMMANDS: SlashCommandInfo[] = []
const EMPTY_AGENTS: AgentInfo[] = []
const EMPTY_OUTPUT_STYLES: string[] = []
const EMPTY_SKILL_INFOS: SkillInfo[] = []

export const selectClaudeResources = (s: ChatStore): ClaudeResources | null => s.harnessResources.claude
export const selectCodexResources = (s: ChatStore): CodexResources | null => s.harnessResources.codex
export const selectClaudeModels = (s: ChatStore): ModelOption[] => s.harnessResources.claude?.models ?? EMPTY_MODELS
export const selectCodexModels = (s: ChatStore): ModelOption[] => s.harnessResources.codex?.models ?? EMPTY_MODELS
export const selectCodexPrompts = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.codex?.prompts ?? EMPTY_SLASH_COMMANDS
export const selectActiveCodexSkills = (s: ChatStore): SkillInfo[] => {
  if (!s.activeProject) return EMPTY_SKILL_INFOS
  return s.projectSessions[s.activeProject]?._codexSkills ?? EMPTY_SKILL_INFOS
}
export const selectClaudeAccount = (s: ChatStore): AccountInfo => s.harnessResources.claude?.account ?? EMPTY_ACCOUNT
export const selectClaudeSlashCommands = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.slashCommands ?? EMPTY_SLASH_COMMANDS
export const selectClaudeSkills = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.skills ?? EMPTY_SLASH_COMMANDS
export const selectClaudeCommands = (s: ChatStore): SlashCommandInfo[] => s.harnessResources.claude?.commands ?? EMPTY_SLASH_COMMANDS
export const selectClaudeAgents = (s: ChatStore): AgentInfo[] => s.harnessResources.claude?.agents ?? EMPTY_AGENTS
export const selectClaudeOutputStyles = (s: ChatStore): string[] => s.harnessResources.claude?.outputStyles ?? EMPTY_OUTPUT_STYLES
