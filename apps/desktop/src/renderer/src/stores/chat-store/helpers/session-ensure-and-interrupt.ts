import { toast } from 'sonner'
import i18n from 'i18next'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'
import { applyEventToSession } from '../event-reducer'
import { isAppInputRequest } from '@superone/shared/input-request-presentation'
import { seedNewSession } from '@/harness-ui/strategies'
import { buildSlashCommands } from './chat-helpers'
import type { ChatStoreSet } from './lifecycle'
import { applyCachedCodexPermissionPreset, sandboxModeToInfo, sessionDefaultsFor } from './prefs-cache'
import { DEFAULT_PROVIDER } from '../event-reducer/transformers'
import {
  commitPerSession,
  getActivePerSession,
  resolveWriteScope,
  updateActivePerSession,
  updatePerSession,
} from './store-helpers'
import { createDefaultPerSessionState, createDefaultProjectState, createSessionId, freshSubagentColorPool } from '../defaults'
import { removeRemoteSession } from '../index'
import type { ChatStore, PerSessionState, SessionWriteTarget } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { interruptSession } from '@/lib/session-client'
import { stopBashOutputLive } from './bash-output-live'
import { environmentIdForProjectKey, selectionForNewSession } from '@superone/shared/session-location'
import type { SessionEnvironmentSelection } from '@superone/shared/session-location'

export function selectionForWorktreeSwitch(
  projectPath: string,
  previous: PerSessionState | undefined,
  opts?: { wtPath?: string; gitBranch?: string | null },
): SessionEnvironmentSelection {
  const environmentId = previous?.environmentSelection?.environmentId
    ?? environmentIdForProjectKey(projectPath)
  if (opts?.wtPath) {
    return {
      environmentId,
      selection: {
        kind: 'existing',
        path: opts.wtPath,
        ...(opts.gitBranch ? { branch: opts.gitBranch } : {}),
      },
    }
  }
  return selectionForNewSession(environmentId)
}

export function ensureSessionImpl(
  set: ChatStoreSet,
  projectPath: string,
  get?: () => ChatStore,
): void {
  const isRemote = !!parseRemoteProjectKey(projectPath)
  set((s) => {
    if (s.projectSessions[projectPath]) return {}
    const project = createDefaultProjectState()
    const claude = s.harnessResources.claude
    project.agents = isRemote ? [] : (claude?.agents ?? [])
    project.slashCommands = isRemote
      ? []
      : buildSlashCommands(
          claude?.slashCommands ?? [],
          claude?.skills ?? [],
          claude?.commands ?? [],
          project._projectSkills,
          project._projectCommands,
          new Set(s.disabledSkills),
        )
    project.codexModels = isRemote ? [] : (s.harnessResources.codex?.models ?? [])
    const draftDefaults = sessionDefaultsFor(DEFAULT_PROVIDER)
    if (draftDefaults.sandboxMode) project.sandboxInfo = sandboxModeToInfo(draftDefaults.sandboxMode)

    const draftId = createSessionId()
    project._activeSessionId = draftId
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = projectPath
    if (draftDefaults.permissionMode) newSession.permissionMode = draftDefaults.permissionMode
    if (!isRemote) {
      seedNewSession(newSession, newSession.preferredProvider, {
        state: s, project, claudeModels: s.harnessResources.claude?.models ?? [],
      })
    }
    project._sessions = { [draftId]: newSession }
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: project,
      },
    }
  })
  if (get && isRemote) {
    void (async () => {
      try {
        const { fetchRemoteHarnessResourcesForProject } = await import(
          '@/lib/remote-harness-resources'
        )
        const bundle = await fetchRemoteHarnessResourcesForProject(projectPath)
        if (bundle && (bundle.claude || bundle.codex)) {
          const claude = bundle.claude
          const skills = Array.isArray(claude?.skills) ? claude.skills : []
          const commands = Array.isArray(claude?.commands) ? claude.commands : []
          set((s) => {
            if (!s.projectSessions[projectPath]) return {}
            const proj = s.projectSessions[projectPath]!
            return {
              harnessResources: {
                ...s.harnessResources,
                ...(claude
                  ? {
                      claude: {
                        models: claude.models ?? [],
                        account: claude.account ?? {},
                        slashCommands: claude.slashCommands ?? [],
                        skills,
                        commands,
                        agents: claude.agents ?? [],
                        outputStyles: claude.outputStyles ?? [],
                      },
                    }
                  : {}),
                ...(bundle.codex
                  ? {
                      codex: {
                        models: bundle.codex.models ?? [],
                        prompts: bundle.codex.prompts ?? [],
                      },
                    }
                  : {}),
              },
              projectSessions: {
                ...s.projectSessions,
                [projectPath]: {
                  ...proj,
                  agents: claude?.agents ?? proj.agents,
                  claudeModels: claude?.models ?? proj.claudeModels,
                  codexModels: bundle.codex?.models ?? proj.codexModels,
                  _projectSkills: skills.length > 0 ? skills : proj._projectSkills,
                  _projectCommands: commands.length > 0 ? commands : proj._projectCommands,
                  slashCommands:
                    claude
                      ? buildSlashCommands(
                          claude.slashCommands ?? [],
                          [],
                          [],
                          skills,
                          commands,
                          new Set(s.disabledSkills),
                        )
                      : proj.slashCommands,
                },
              },
            }
          })
          return
        }
      } catch {
        void 0
      }
      try {
        const listed = await window.app.listSlashResources(projectPath)
        const skills = Array.isArray(listed?.skills) ? listed.skills : []
        const commands = Array.isArray(listed?.commands) ? listed.commands : []
        set((s) => {
          if (!s.projectSessions[projectPath]) return {}
          const proj = s.projectSessions[projectPath]!
          return {
            projectSessions: {
              ...s.projectSessions,
              [projectPath]: {
                ...proj,
                _projectSkills: skills,
                _projectCommands: commands,
                slashCommands: buildSlashCommands(
                  [],
                  [],
                  [],
                  skills,
                  commands,
                  new Set(s.disabledSkills),
                ),
              },
            },
          }
        })
      } catch {
        void 0
      }
    })()
    void get().refreshCodexModels(false)
    void get().refreshClaudeResources(false)
  }
}

export function disconnectRemoteSessionImpl(set: ChatStoreSet, get: () => ChatStore): void {
  const state = get()
  const projectPath = state.activeProject
  const sid = projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? undefined : undefined
  void window.environment.disconnectSessionController(sid)
  if (sid && projectPath) {
    set((s) => ({ remoteSessions: removeRemoteSession(s.remoteSessions, projectPath, sid) }))
  } else {
    set({ remoteSessions: {} })
  }
}

export async function interruptImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  target?: SessionWriteTarget,
): Promise<void> {
  const { projectPath, sessionId } = resolveWriteScope(get(), target)
  if (!projectPath) return
  if (!sessionId) {
    set(s => commitPerSession(s, target, () => ({ status: 'idle', awaitingAssistantReply: false })))
    return
  }
  const before = get().projectSessions[projectPath]?._sessions[sessionId]
  if (!before || before.interruptPending) return
  const tailId = before.messages.at(-1)?.id
  set(s => updatePerSession(s, projectPath, sessionId, () => ({ interruptPending: true })))
  try {
    const receipt = await interruptSession(projectPath, sessionId)
    if (receipt?.status === 'stopped') {
      settleInterruptedTurn(set, projectPath, sessionId, tailId)
    } else {
      setTimeout(() => { void reconcileLegacyInterrupt(set, get, projectPath, sessionId, tailId) }, 12_000)
    }
  } catch (err) {
    toast.error(i18n.t('chat.interruptFailed'), { description: err instanceof Error ? err.message : String(err) })
  } finally {
    set(s => updatePerSession(s, projectPath, sessionId, () => ({ interruptPending: false })))
  }
}

function settleInterruptedTurn(set: ChatStoreSet, projectPath: string, sessionId: string, tailId?: string): void {
  set(s => updatePerSession(s, projectPath, sessionId, current => {
    if (current.messages.at(-1)?.id !== tailId) return {}
    let next = current
    for (const message of current.messages) {
      if (message.role === 'assistant' && message.status === 'streaming') {
        next = { ...next, ...applyEventToSession(next, { type: 'message_interrupted', messageId: message.id }) }
      }
    }
    return { ...next, status: 'idle', awaitingAssistantReply: false,
      pendingPermissions: next.pendingPermissions.filter(isAppInputRequest),
      pendingQuestion: null, pendingPlanApproval: null }
  }))
}

async function reconcileLegacyInterrupt(
  set: ChatStoreSet, get: () => ChatStore, projectPath: string, sessionId: string, tailId?: string,
): Promise<void> {
  const session = get().projectSessions[projectPath]?._sessions[sessionId]
  if (session?.status !== 'streaming' || session.messages.at(-1)?.id !== tailId || session.interruptPending) return
  try {
    const record = await window.environment.getSession(connectionIdForProjectKey(projectPath), sessionId) as { status?: string } | null
    if (record && ['idle', 'interrupted', 'ended'].includes(record.status ?? '')) {
      settleInterruptedTurn(set, projectPath, sessionId, tailId)
    }
  } catch { void 0 }
}

export function clearMessagesImpl(set: ChatStoreSet, get: () => ChatStore): void {
  const { activeProject, _bashOutputs } = get()
  if (!activeProject) return
  const session = getActivePerSession(get())
  const sessionToolUseIds = new Set<string>()
  if (session) {
    for (const msg of session.messages) {
      for (const b of msg.content) {
        if (b.type === 'tool_use') sessionToolUseIds.add(b.toolUseId)
      }
    }
  }
  for (const id of sessionToolUseIds) {
    if (_bashOutputs[id]) stopBashOutputLive(id)
  }
  const remainingOutputs: typeof _bashOutputs = {}
  for (const [id, val] of Object.entries(_bashOutputs)) {
    if (!sessionToolUseIds.has(id)) remainingOutputs[id] = val
  }
  set((s) => ({
    ...updateActivePerSession(s, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermissions: [], pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      subagentColors: {}, _subagentColorsFree: freshSubagentColorPool(),
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      awaitingAssistantReply: false,
      codexPlanRejectHintActive: false,
      chatInputFocusNonce: 0,
      queuedMessages: [],
    })),
    _bashOutputs: remainingOutputs,
  }))
}
