import type { StateCreator } from 'zustand'
import type {
  AgentEvent,
  AgentStatus,
  ChatMessage,
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  EffortLevel,
  SessionSettingsPatch,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import type { ChatProvider, ChatStore, PerSessionState } from '../types'
import { buildSlashCommands } from '../helpers/chat-helpers'
import { accumulateCodexFooterTokens, getCodexUsageStepTokens } from '../helpers/codex-helpers'
import { mergeMessagesByMaxSeq } from '../helpers/event-helpers'
import { inferProviderFromHarnessId } from '../helpers/provider-routing'
import { createDefaultPerSessionState, createDefaultProjectState, getDefaultEffortForModel } from '../defaults'
import { clearStreamingToolInputsForSession } from '../event-reducer/shared'
import { shouldReviveStreaming } from '../event-reducer/stream-revive'
import { applyCachedCodexPermissionPreset } from '../helpers/prefs-cache'
import { startBashOutputLive } from '../helpers/bash-output-live'
import {
  _computeHasPendingInteraction,
  _ensureSessionHydrated,
  _hydrateSessionState,
  _isLiveSession,
  addRemoteSession,
  applyEventToSession,
  getCodexCompletionEventMeta,
  getCodexContextTokens,
  getCodexTraceItems,
  isMountedSession,
  isRemoteSession,
  removeRemoteSession,
  summarizeCodexTraceItem,
  updateProjectState,
} from '../index'

/** Map live-snapshot UI settings into PerSessionState (composer / status bar). */
function sessionPatchFromUiSettings(
  ui: SessionSettingsPatch | undefined,
  prev: PerSessionState,
): Partial<PerSessionState> {
  if (!ui) return {}
  const patch: Partial<PerSessionState> = {}
  if (ui.permissionMode !== undefined) patch.permissionMode = ui.permissionMode
  if (ui.selectedModel !== undefined && ui.selectedModel !== null) {
    patch.selectedModel = ui.selectedModel
  }
  if (ui.selectedEffort !== undefined) {
    patch.selectedEffort = (ui.selectedEffort ?? undefined) as EffortLevel | undefined
  }
  if (ui.selectedCodexModel !== undefined && ui.selectedCodexModel !== null) {
    patch.selectedCodexModel = ui.selectedCodexModel
  }
  if (ui.selectedCodexReasoningEffort !== undefined) {
    patch.selectedCodexReasoningEffort = (ui.selectedCodexReasoningEffort ?? undefined) as CodexReasoningEffort | undefined
  }
  if (ui.selectedCodexServiceTier !== undefined) {
    patch.selectedCodexServiceTier = ui.selectedCodexServiceTier
  }
  if (ui.selectedCodexPermissionPreset != null) {
    patch.selectedCodexPermissionPreset = ui.selectedCodexPermissionPreset as CodexPermissionPreset
  }
  if (ui.selectedCodexCollaborationMode != null) {
    patch.selectedCodexCollaborationMode = ui.selectedCodexCollaborationMode as CodexCollaborationMode
  }
  if (ui.openCodeAgentId !== undefined) {
    patch.openCodeAgentId = ui.openCodeAgentId
  }
  if (ui.selectedAcpModeId !== undefined) {
    patch.selectedAcpModeId = ui.selectedAcpModeId
  }
  if (ui.apiProviderId !== undefined) {
    patch.apiProviderId = ui.apiProviderId
  }
  // Prefer explicit ui values; fall back to prev only when field absent.
  void prev
  return patch
}

/**
 * Event-related actions. Both implementations now live here.
 *
 * - `handleAgentEvent` is the central agent → store dispatch reducer. It
 *   handles four route classes:
 *   1. Global (no projectPath): remote_session_start/end, provider_changed,
 *      session_title_changed.
 *   2. Per-session (with projectPath/sessionId): routed through one of
 *      exact / lazy_session / fallback_active match modes, then delegated
 *      to `applyEventToSession` reducer for the per-session state delta.
 *   3. Post-apply side effects: dev tracing, init_ready project-level
 *      patches, codex hydration save, idle-session evict & unseen markers.
 *   4. Hydration trigger and worktree-missing notification.
 *
 * - `syncLiveSnapshots` rehydrates the store from main's live session
 *   snapshots on focus.
 */
export interface EventSlice {
  handleAgentEvent: (event: AgentEvent) => void
  syncLiveSnapshots: () => Promise<void>
}

export const createEventSlice: StateCreator<ChatStore, [], [], EventSlice> = (set, get) => ({
  handleAgentEvent: (event: AgentEvent) => {
    if (event.type === 'remote_session_start') {
      const projectPath = event.remoteProjectPath
      const sessionId = event.remoteSessionId
      const remoteProvider = inferProviderFromHarnessId(event.harnessId)
      set((s) => {
        const project = s.projectSessions[projectPath] ?? createDefaultProjectState()
        const existingSession = project._sessions[sessionId]
        const baseSession = existingSession ?? {
          ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()),
          _historyHydrated: !event.isSubscribe,
        }
        const nextSession = remoteProvider && !baseSession.sessionProvider
          ? { ...baseSession, sessionProvider: remoteProvider, preferredProvider: remoteProvider }
          : baseSession
        return {
          remoteSessions: event.isSubscribe
            ? addRemoteSession(s.remoteSessions, projectPath, sessionId)
            : s.remoteSessions,
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: { ...project._sessions, [sessionId]: nextSession },
            },
          },
        }
      })
      if (event.isSubscribe) {
        _hydrateSessionState(set, projectPath, sessionId)
      }
      return
    }
    if (event.type === 'provider_changed') {
      if (event.harnessId === 'codex') {
        void get().refreshCodexModels(true)
      }
      return
    }
    if (event.type === 'remote_session_end') {
      if (!event.isSubscribe) return
      set((s) => ({
        remoteSessions: removeRemoteSession(s.remoteSessions, event.remoteProjectPath, event.remoteSessionId),
      }))
      return
    }

    if (event.type === 'session_title_changed') {
      const { sessionId, title, projectPath: targetProjectPath } = event
      set((s) => {
        const next: Partial<ChatStore> = {
          agentTitles: { ...s.agentTitles, [sessionId]: title },
        }
        if (!targetProjectPath) return next
        const project = s.projectSessions[targetProjectPath]
        if (!project) return next
        let sessionsChanged = false
        const sessions = project.sessions.map((entry) => {
          if (entry.sessionId === sessionId && entry.title !== title) {
            sessionsChanged = true
            return { ...entry, title }
          }
          return entry
        })
        const perSession = project._sessions[sessionId]
        const perSessionChanged = !!perSession && perSession._title !== title
        if (!sessionsChanged && !perSessionChanged) return next
        return {
          ...next,
          projectSessions: {
            ...s.projectSessions,
            [targetProjectPath]: {
              ...project,
              ...(sessionsChanged ? { sessions } : {}),
              ...(perSessionChanged
                ? { _sessions: { ...project._sessions, [sessionId]: { ...perSession, _title: title } } }
                : {}),
            },
          },
        }
      })
      return
    }

    if (event.type === 'shared_file_progress') {
      const { path, loaded, total } = event
      set((s) => ({ _shareProgress: { ...s._shareProgress, [path]: { loaded, total } } }))
      return
    }

    const projectPath = event.projectPath
    const eventSessionId = event.sessionId
    if (!projectPath) return
    if (event.type === 'additional_dirs_changed') {
      set((s) => updateProjectState(s, projectPath, (project) => {
        const targetSid = eventSessionId ?? project._activeSessionId
        const session = targetSid ? project._sessions[targetSid] : undefined
        return {
          // One harness-neutral set — no codex/claude pair to mirror into.
          projectExtraDirs: [...event.workspaceDirs],
          ...(session && targetSid
            ? {
                _sessions: {
                  ...project._sessions,
                  [targetSid]: {
                    ...session,
                    additionalDirs: [...event.sessionAdditionalDirs],
                    additionalDirsDirty: false,
                  },
                },
              }
            : {}),
        }
      }))
      return
    }
    if (event.type === 'agent_setting_change' && event.patch?.sandboxInfo) {
      const next = event.patch.sandboxInfo
      set((s) => updateProjectState(s, projectPath, () => ({ sandboxInfo: next })))
    }
    let hydrateSessionId: string | null = null

    set((s) => {
      let project = s.projectSessions[projectPath] ?? createDefaultProjectState()

      let matchType: 'exact' | 'lazy_session' | 'fallback_active'
      let targetSid: string | null

      if (eventSessionId && project._sessions[eventSessionId]) {
        targetSid = eventSessionId
        matchType = 'exact'
      } else if (eventSessionId) {
        project = {
          ...project,
          _sessions: {
            ...project._sessions,
            [eventSessionId]: {
              ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()),
              _historyHydrated: false,
            },
          },
        }
        hydrateSessionId = eventSessionId
        targetSid = eventSessionId
        matchType = 'lazy_session'
      } else if (project._activeSessionId) {
        targetSid = project._activeSessionId
        matchType = 'fallback_active'
      } else {
        if (import.meta.env.DEV) {
          window.app.trace?.('session.route.dropped', event.type, {
            reason: 'no_route',
            eventSessionId,
            activeSid: project._activeSessionId,
            knownSids: Object.keys(project._sessions),
          })
        }
        return {}
      }

      // DEV-only: this runs for *every* agent event, including one per streaming
      // delta batch. `Object.keys` + the structured clone for the IPC send are
      // pure waste in production, where the main-process handler drops it anyway.
      if (import.meta.env.DEV) {
        window.app.trace?.('session.route', event.type, {
          matchType,
          targetSid,
          eventSessionId,
          activeSid: project._activeSessionId,
          knownSids: Object.keys(project._sessions),
        })
      }

      if (event.type === 'permission_request') {
        window.app.trace?.('permission.flow', 'renderer_route', {
          matchType,
          targetSid,
          eventSessionId,
          activeSid: project._activeSessionId,
          isTargetActive: targetSid === project._activeSessionId,
          toolName: event.request.toolName,
        }, event.request.requestId)
        if (targetSid !== project._activeSessionId) {
          console.warn('[permission-drift] permission_request landed on non-active session', {
            requestId: event.request.requestId,
            toolName: event.request.toolName,
            eventSessionId,
            targetSid,
            activeSid: project._activeSessionId,
            matchType,
            knownSids: Object.keys(project._sessions),
          })
        }
      }

      if (matchType === 'lazy_session') {
        console.warn('[session-drift] lazy_session created from incoming event', {
          eventType: event.type,
          eventSessionId,
          activeSid: project._activeSessionId,
          knownSids: Object.keys(project._sessions).filter((k) => k !== eventSessionId),
        })
      }

      if (!project._sessions[targetSid]) {
        return {}
      }

      const targetSession = project._sessions[targetSid]
      const delta = applyEventToSession(targetSession, event)
      const updatedSession = { ...targetSession, ...delta }
      // Stream traffic outranks a stale `idle`: a session that is still being
      // written to is streaming, whatever the last status event claimed. This
      // is what keeps Stop reachable when a harness misses a re-arm.
      if (shouldReviveStreaming(updatedSession, event)) {
        updatedSession.status = 'streaming'
      }

      if (import.meta.env.DEV) {
        const codexItemTrace = event.type === 'codex_item_delta'
          ? {
              codexPhase: event.phase,
              codexItemId: event.item.id,
              codexItemType: event.item.type,
              codexTextLength: event.item.type === 'reasoning' || event.item.type === 'plan' || event.item.type === 'agent_message' || event.item.type === 'review'
                ? event.item.text.length
                : undefined,
              codexTextPreview: event.item.type === 'reasoning' || event.item.type === 'plan' || event.item.type === 'agent_message' || event.item.type === 'review'
                ? event.item.text.slice(0, 160)
                : undefined,
              ...(event.item.type === 'collab_tool_call' ? {
                collabTool: event.item.tool,
                collabStatus: event.item.status,
                agentIds: Object.keys(event.item.agentsStates),
                agentStatuses: Object.fromEntries(Object.entries(event.item.agentsStates).map(([k, v]) => [k, v.status])),
                childThreadCount: event.item.childItems ? Object.keys(event.item.childItems).length : 0,
                childItemCounts: event.item.childItems
                  ? Object.fromEntries(Object.entries(event.item.childItems).map(([k, v]) => [k, v.length]))
                  : undefined,
              } : {}),
            }
          : {}
        window.app.trace?.('agent.store', event.type, {
          targetSid,
          eventSessionId,
          deltaKeys: Object.keys(delta),
          ...('status' in delta ? { status: delta.status } : {}),
          ...(event.type === 'message_start' ? { role: event.message.role, messageId: event.message.id } : {}),
          ...('taskProgress' in delta ? { taskProgressKeys: Object.keys(delta.taskProgress ?? {}) } : {}),
          ...codexItemTrace,
        }, (event as any).messageId)
        if (event.type === 'message_usage' && event.codexUsage) {
          const stepTokens = getCodexUsageStepTokens(event.codexUsage)
          const footerTokens = accumulateCodexFooterTokens(targetSession.streamingTokens, event.codexUsage, targetSession.codexTurnLastUsage)
          window.app.trace?.('codex.usage.computed', event.type, {
            raw: {
              total: {
                inputTokens: event.codexUsage.totalInputTokens,
                cachedInputTokens: event.codexUsage.totalCachedInputTokens,
                outputTokens: event.codexUsage.totalOutputTokens,
              },
              last: {
                inputTokens: event.codexUsage.lastInputTokens,
                cachedInputTokens: event.codexUsage.lastCachedInputTokens,
                outputTokens: event.codexUsage.lastOutputTokens,
              },
              reasoningOutputTokens: event.codexUsage.reasoningOutputTokens,
              contextWindow: event.codexUsage.contextWindow,
            },
            computedStepTokens: stepTokens,
            computedContextTokens: getCodexContextTokens(event.codexUsage),
            computedTurnDeltaTokens: footerTokens,
            displayFooterInput: footerTokens.input,
            displayFooterOutput: footerTokens.output,
          }, event.messageId)
        }
        if (updatedSession.sessionProvider === 'codex' && (event.type === 'codex_item_delta' || event.type === 'message_complete')) {
          const beforeMessage = targetSession.messages.find((msg) => msg.id === event.messageId)
          const afterMessage = updatedSession.messages.find((msg) => msg.id === event.messageId)
          const prevItems = getCodexTraceItems(beforeMessage)
          const nextItems = getCodexTraceItems(afterMessage)
          const completionItems = event.type === 'message_complete'
            ? getCodexCompletionEventMeta(event.metadata)?.items ?? []
            : []
          window.app.trace?.('codex.live', event.type, {
            targetSid,
            eventSessionId,
            activeSid: project._activeSessionId,
            messageId: event.messageId,
            lastAssistantMessageIdBefore: targetSession.lastAssistantMessageId,
            lastAssistantMessageIdAfter: updatedSession.lastAssistantMessageId,
            activeCodexMessageIdBefore: targetSession.activeCodexMessageId,
            activeCodexMessageIdAfter: updatedSession.activeCodexMessageId,
            prevItemsLength: prevItems.length,
            nextItemsLength: nextItems.length,
            prevItemsTail: prevItems.tail,
            nextItemsTail: nextItems.tail,
            ...(event.type === 'codex_item_delta'
              ? {
                  phase: event.phase,
                  incomingItem: summarizeCodexTraceItem(event.item),
                }
              : {
                  completionItemsLength: completionItems.length,
                  completionItemsTail: completionItems.slice(-3).map(summarizeCodexTraceItem),
                  finalResponseLength: getCodexCompletionEventMeta(event.metadata)?.finalResponse?.length ?? 0,
                }),
          }, event.messageId)
        }
      }

      const updatedSessions = { ...project._sessions, [targetSid]: updatedSession }
      const updatedProject = { ...project, _sessions: updatedSessions }

      if (event.type === 'init_ready') {
        updatedSession.cwd = event.cwd
        updatedProject.homedir = event.homedir
        updatedProject.sandboxInfo = event.sandboxInfo
        updatedProject._projectSkills = event.skills
        updatedProject._projectCommands = event.projectCommands
        const claudeRes = s.harnessResources.claude
        updatedProject.slashCommands = buildSlashCommands(
          claudeRes?.slashCommands ?? [], claudeRes?.skills ?? [], claudeRes?.commands ?? [],
          event.skills, event.projectCommands,
          new Set(s.disabledSkills),
        )
        updatedProject.agents = [...(claudeRes?.agents ?? []), ...event.projectAgents]

        const globalModels = claudeRes?.models ?? []
        if (!updatedSession.selectedModel && globalModels[0]) {
          updatedSession.selectedModel = globalModels[0].id
          const effort = getDefaultEffortForModel(globalModels[0])
          if (effort) updatedSession.selectedEffort = effort
          updatedProject._sessions = { ...updatedProject._sessions, [targetSid]: updatedSession }
        }
      }

      const effectiveSid = targetSid
      if (effectiveSid) {
        if (
          updatedSession.sessionProvider === 'codex'
          && (
          (event.type === 'session_init' && event.session) ||
          (event.type === 'content_delta' && event.delta.type === 'tool_result') ||
          event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error'
          )
        ) {
          const snapshot = updatedSession
          setTimeout(() => _ensureSessionHydrated(effectiveSid, snapshot), 0)
        }
      }

      if (event.type === 'status_change' && event.status === 'idle' && targetSid !== updatedProject._activeSessionId) {
        if (!_isLiveSession(updatedSession)) {
          // Protect:
          // - mobile remote-control subscriptions (isRemoteSession)
          // - mosaic/mounted tiles
          // - remote *node* project sessions — no desktop SQLite; idle eviction
          //   would force cold rehydrate and drop stream-only assistant turns
          //   (interrupted / error / mid-catalog lag).
          const isRemoteNodeProject = projectPath.startsWith('remote:')
          const isProtected =
            isRemoteSession(s, projectPath, targetSid) ||
            isMountedSession(s, projectPath, targetSid) ||
            isRemoteNodeProject
          if (!isProtected && effectiveSid) {
            updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
            if (updatedSession.sessionProvider === 'codex') {
              const snapshot = updatedSession
              const evictSid = targetSid
              const evictProjectPath = projectPath
              setTimeout(() => {
                _ensureSessionHydrated(effectiveSid, snapshot).then(() => {
                  set((s2) => {
                    const proj = s2.projectSessions[evictProjectPath]
                    if (!proj?._sessions[evictSid]) return {}
                    if (proj._activeSessionId === evictSid) return {}
                    if (_isLiveSession(proj._sessions[evictSid])) return {}
                    if (isMountedSession(s2, evictProjectPath, evictSid)) return {}
                    const { [evictSid]: _, ...rest } = proj._sessions
                    // Scoped global Map cleanup — only this session's tool ids (not Map.clear()).
                    clearStreamingToolInputsForSession(evictProjectPath, evictSid)
                    return { projectSessions: { ...s2.projectSessions, [evictProjectPath]: { ...proj, _sessions: rest } } }
                  })
                })
              }, 0)
            } else {
              const { [targetSid]: _, ...restSessions } = updatedProject._sessions
              updatedProject._sessions = restSessions
              clearStreamingToolInputsForSession(projectPath, targetSid)
            }
          } else if (!isProtected) {
            const { [targetSid]: _, ...restSessions } = updatedProject._sessions
            updatedProject._sessions = restSessions
            clearStreamingToolInputsForSession(projectPath, targetSid)
          }
        }
      }

      const isBackground = projectPath !== s.activeProject

      if (event.type === 'status_change' && event.status === 'idle' && targetSid === updatedProject._activeSessionId && isBackground && effectiveSid) {
        updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
      }

      if (isBackground) {
        updatedProject.hasUnseenActivity = true
      }
      updatedProject.hasPendingInteraction = _computeHasPendingInteraction(updatedProject)

      let bashOutputUpdate: Partial<ChatStore> | undefined
      if (event.type === 'content_delta' && event.delta.type === 'tool_result' && event.delta.outputPath) {
        const tid = event.delta.toolUseId
        const op = event.delta.outputPath
        bashOutputUpdate = {
          _bashOutputs: { ...s._bashOutputs, [tid]: { content: s._bashOutputs[tid]?.content ?? '', finished: false, outputPath: op } },
        }
        // Remote: EnvironmentHost → node tailWatch/readFile RPC (never local fs.watch).
        // Local: desktop bash-output-watcher.
        setTimeout(() => {
          startBashOutputLive({
            toolUseId: tid,
            outputPath: op,
            projectKey: projectPath,
          })
        }, 0)
      }

      let harnessUpdate: Partial<ChatStore> | undefined
      if (
        (event.type === 'acp_models' || event.type === 'acp_modes' || event.type === 'acp_commands')
        && (event.type === 'acp_commands' || event.status === 'ready' || !event.status)
      ) {
        const agentId = event.agentId ?? updatedSession.acpAgentId
        const acp = s.harnessResources.acp
        const hasContent = event.type === 'acp_models'
          ? event.models.length > 0
          : event.type === 'acp_modes'
            ? event.modes.length > 0
            : true
        if (
          agentId
          && acp
          && hasContent
          && (!updatedSession.acpAgentId || !event.agentId || event.agentId === updatedSession.acpAgentId)
        ) {
          const prevConfig = acp.configByAgentId?.[agentId]
          const prevOptions = [...(prevConfig?.configOptions ?? [])]
          const now = new Date().toISOString()

          if (event.type === 'acp_models') {
            const modelId = event.configId ?? 'model'
            const modelOpt = {
              id: modelId,
              name: 'Model',
              category: 'model' as const,
              type: 'select' as const,
              currentValue: event.selectedModelId,
              options: event.models.map((m) => ({
                value: m.id,
                name: m.name,
                description: m.description || null,
              })),
            }
            const withoutModel = prevOptions.filter((o) => o.category !== 'model' && o.id !== 'model' && o.id !== modelId)
            const configOptions = event.configId
              ? [...withoutModel, modelOpt]
              : prevOptions
            harnessUpdate = {
              harnessResources: {
                ...s.harnessResources,
                acp: {
                  ...acp,
                  modelsByAgentId: {
                    ...(acp.modelsByAgentId ?? {}),
                    [agentId]: {
                      models: event.models,
                      selectedModelId: event.selectedModelId,
                      configId: event.configId,
                      updatedAt: now,
                    },
                  },
                  configByAgentId: {
                    ...(acp.configByAgentId ?? {}),
                    [agentId]: {
                      configOptions,
                      extraModels: event.configId ? prevConfig?.extraModels : event.models,
                      selectedModelId: event.selectedModelId,
                      modelConfigId: event.configId,
                      extraModes: prevConfig?.extraModes,
                      selectedModeId: prevConfig?.selectedModeId,
                      modeConfigId: prevConfig?.modeConfigId,
                      slashCommands: prevConfig?.slashCommands,
                      updatedAt: now,
                    },
                  },
                },
              },
            }
          } else if (event.type === 'acp_modes') {
            // Grok effort: configId is null → store as extraModes so UI keeps
            // modeConfigId null (effort slider next to model, not status-bar mode).
            // Real session modes: configId set → configOptions category=mode.
            if (event.configId == null) {
              const withoutMode = prevOptions.filter(
                (o) => o.category !== 'mode' && o.id !== 'mode',
              )
              harnessUpdate = {
                harnessResources: {
                  ...s.harnessResources,
                  acp: {
                    ...acp,
                    configByAgentId: {
                      ...(acp.configByAgentId ?? {}),
                      [agentId]: {
                        configOptions: withoutMode,
                        extraModels: prevConfig?.extraModels,
                        selectedModelId: prevConfig?.selectedModelId ?? null,
                        modelConfigId: prevConfig?.modelConfigId ?? null,
                        extraModes: event.modes,
                        selectedModeId: event.selectedModeId,
                        modeConfigId: null,
                        slashCommands: prevConfig?.slashCommands,
                        updatedAt: now,
                      },
                    },
                  },
                },
              }
            } else {
              const modeId = event.configId
              const modeOpt = {
                id: modeId,
                name: 'Session Mode',
                category: 'mode' as const,
                type: 'select' as const,
                currentValue: event.selectedModeId,
                options: event.modes.map((m) => ({
                  value: m.id,
                  name: m.name,
                  description: m.description || null,
                })),
              }
              const withoutMode = prevOptions.filter(
                (o) => o.category !== 'mode' && o.id !== 'mode' && o.id !== modeId,
              )
              harnessUpdate = {
                harnessResources: {
                  ...s.harnessResources,
                  acp: {
                    ...acp,
                    configByAgentId: {
                      ...(acp.configByAgentId ?? {}),
                      [agentId]: {
                        configOptions: [...withoutMode, modeOpt],
                        extraModels: prevConfig?.extraModels,
                        selectedModelId: prevConfig?.selectedModelId ?? null,
                        modelConfigId: prevConfig?.modelConfigId ?? null,
                        // Drop stale Grok effort extras when real session modes arrive.
                        extraModes: undefined,
                        selectedModeId: event.selectedModeId,
                        modeConfigId: modeId,
                        slashCommands: prevConfig?.slashCommands,
                        updatedAt: now,
                      },
                    },
                  },
                },
              }
            }
          } else {
            harnessUpdate = {
              harnessResources: {
                ...s.harnessResources,
                acp: {
                  ...acp,
                  configByAgentId: {
                    ...(acp.configByAgentId ?? {}),
                    [agentId]: {
                      configOptions: prevConfig?.configOptions ?? [],
                      extraModels: prevConfig?.extraModels,
                      selectedModelId: prevConfig?.selectedModelId ?? null,
                      modelConfigId: prevConfig?.modelConfigId ?? null,
                      extraModes: prevConfig?.extraModes,
                      selectedModeId: prevConfig?.selectedModeId,
                      modeConfigId: prevConfig?.modeConfigId,
                      slashCommands: event.commands,
                      updatedAt: now,
                    },
                  },
                },
              },
            }
          }
        }
      }

      return {
        ...bashOutputUpdate,
        ...harnessUpdate,
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: updatedProject,
        },
      }
    })
    if (hydrateSessionId) {
      _hydrateSessionState(set, projectPath, hydrateSessionId)
    }
    if (event.type === 'worktree_missing' && projectPath === get().activeProject) {
      useAppStore.getState().setActiveWorktree(projectPath, null)
    }
  },

  syncLiveSnapshots: async () => {
    const getSnap = window.agent.getLiveSnapshots
    if (!getSnap) return
    let entries
    try {
      entries = await getSnap()
    } catch (err) {
      console.warn('[chat] getLiveSnapshots failed:', err)
      return
    }
    if (!entries || entries.length === 0) return

    const activeByProject = new Map<string, string>()
    for (const entry of entries) {
      if (entry.isActive) activeByProject.set(entry.projectPath, entry.sid)
    }

    set((s) => {
      const nextProjects = { ...s.projectSessions }
      for (const entry of entries) {
        const prevProject = nextProjects[entry.projectPath] ?? createDefaultProjectState()
        const prevSession = prevProject._sessions[entry.sid] ?? applyCachedCodexPermissionPreset(createDefaultPerSessionState())
        const mergedMessages = mergeMessagesByMaxSeq(entry.snapshot.messages as ChatMessage[], prevSession.messages)
        const provider: ChatProvider = inferProviderFromHarnessId(entry.snapshot.harnessId) ?? 'claude'
        const inferredStatus: AgentStatus = entry.isStreaming ? 'streaming' : prevSession.status === 'error' ? 'error' : 'idle'
        const fromUi = sessionPatchFromUiSettings(entry.uiSettings, prevSession)
        const mergedSession: PerSessionState = {
          ...prevSession,
          cwd: entry.snapshot.cwd,
          messages: mergedMessages,
          totalCostUsd: Math.max(prevSession.totalCostUsd, entry.snapshot.totalCostUsd),
          contextTokens: Math.max(prevSession.contextTokens, entry.snapshot.contextTokens),
          status: inferredStatus,
          awaitingAssistantReply: entry.isStreaming && !entry.snapshot.currentMessageId
            ? prevSession.awaitingAssistantReply
            : false,
          sessionProvider: provider,
          preferredProvider: provider,
          // Live UI settings first (permission / codex presets / effort / …), then
          // explicit snapshot fields as authoritative fallbacks.
          ...fromUi,
          permissionMode: fromUi.permissionMode ?? entry.permissionMode ?? prevSession.permissionMode,
          lastAssistantMessageId: entry.snapshot.currentMessageId ?? prevSession.lastAssistantMessageId,
          _worktreePath: entry.snapshot.worktreePath ?? prevSession._worktreePath,
          _gitBranch: entry.snapshot.gitBranch ?? prevSession._gitBranch,
          _worktreeRemoved: entry.snapshot.worktreeMissing,
          apiProviderId: fromUi.apiProviderId
            ?? entry.snapshot.apiProviderId
            ?? prevSession.apiProviderId
            ?? null,
          // Live snapshot must carry ACP agent identity — without it mini-window
          // brands every ACP session as generic "ACP Agent" after syncLiveSnapshots.
          acpAgentId: entry.snapshot.acpAgentId ?? prevSession.acpAgentId ?? null,
          // Model id from main session (agent_setting_change / acp_models). Full
          // catalog names arrive via replayed acp_models events just below.
          selectedModel: fromUi.selectedModel
            || entry.snapshot.selectedModel
            || prevSession.selectedModel
            || '',
          selectedEffort: fromUi.selectedEffort
            ?? (entry.snapshot.selectedEffort as EffortLevel | null | undefined)
            ?? prevSession.selectedEffort,
          _historyHydrated: true,
        }
        const nextSessions = { ...prevProject._sessions, [entry.sid]: mergedSession }
        const nextActiveSid = activeByProject.get(entry.projectPath) ?? prevProject._activeSessionId ?? entry.sid
        nextProjects[entry.projectPath] = {
          ...prevProject,
          _sessions: nextSessions,
          _activeSessionId: nextActiveSid,
          sandboxInfo: entry.sandboxInfo,
        }
      }
      return { projectSessions: nextProjects }
    })

    for (const entry of entries) {
      for (const ev of entry.replayEvents) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] replay event error:', err) }
      }
      for (const ev of entry.pendingInteractions) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] pending interaction error:', err) }
      }
    }
  },
})
