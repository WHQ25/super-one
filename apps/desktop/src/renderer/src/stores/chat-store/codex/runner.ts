import type {
  ChatMessage,
  ChatMessageContext,
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  ContentBlock,
  ImageAttachment,
} from '@superone/shared/agent-types'
import {
  accumulateCodexFooterTokens,
  getCodexContextTokens,
  getLatestCodexThreadId,
  pruneTransientCodexItems,
  type CodexRunnableCommand,
} from '../helpers/codex-helpers'
import { ChatStoreSet } from '../helpers/lifecycle'
import { _getSessionCwd } from '../helpers/persistence'
import {
  getProject,
  mergeCallerScopedDirs,
  updateActivePerSession,
  updatePerSession,
} from '../helpers/store-helpers'
import type { ChatStore, PerSessionState } from '../types'

export async function runCodexCommand(
  set: ChatStoreSet,
  get: () => ChatStore,
  {
    activeProject,
    codexSessionId,
    session,
    codexCommand,
    finalContent,
    userMessageId,
    attachments,
    selectedCodexPermissionPreset,
    collaborationMode,
    resolvedCodexModel,
    resolvedCodexReasoningEffort,
    userMessageContent,
    contexts,
    userSelections,
  }: {
    activeProject: string
    codexSessionId: string
    session: PerSessionState
    codexCommand: CodexRunnableCommand
    finalContent: string
    userMessageId: string
    attachments: ImageAttachment[]
    selectedCodexPermissionPreset: CodexPermissionPreset
    collaborationMode: CodexCollaborationMode
    resolvedCodexModel?: string
    resolvedCodexReasoningEffort?: CodexReasoningEffort
    userMessageContent?: ContentBlock[]
    contexts?: ChatMessageContext[]
    userSelections?: string[]
  },
): Promise<void> {
  // Project folders are re-read authoritatively in `Session.send`; the caller
  // half here is the session scope, which the store already holds.
  const userMessageExtras = {
    userMessageContent,
    contexts,
    userSelections,
    apiProviderId: session.apiProviderId ?? undefined,
    serviceTier: session.selectedCodexServiceTier,
    additionalDirectories: mergeCallerScopedDirs(getProject(get(), activeProject), session),
  }
  set((s) => updateActivePerSession(s, () => ({ _pendingSlashCommand: '' })))

  const assistantId = `codex_${Date.now()}`
  const previousCodexTurnLastUsage = session.codexTurnLastUsage
  const codexThreadId = getLatestCodexThreadId(session.messages)
  const updateCodexSession = (updater: (s: PerSessionState) => Partial<PerSessionState>) => {
    set((s) => updatePerSession(s, activeProject, codexSessionId, updater))
  }
  const getCodexSession = () => getProject(get(), activeProject)._sessions[codexSessionId]
  const appendAssistant = (message: ChatMessage) => {
    updateCodexSession((sess) => ({
      messages: [...sess.messages, message],
      ...(message.role === 'assistant' ? { lastAssistantMessageId: message.id } : {}),
    }))
  }
  const getTargetAssistantId = () => getCodexSession()?.activeCodexMessageId ?? assistantId
  const updateAssistant = (
    status: 'streaming' | 'complete' | 'interrupted' | 'error',
    text: string,
    metadata?: ChatMessage['metadata'],
    sessionUpdates?: Partial<PerSessionState>,
  ) => {
    const targetAssistantId = getTargetAssistantId()
    updateCodexSession((sess) => ({
      status: status === 'streaming' ? 'streaming' : 'idle',
      ...(status === 'streaming' ? { activeCodexMessageId: targetAssistantId } : { activeCodexMessageId: null }),
      ...(sessionUpdates ?? {}),
      messages: sess.messages.map((m) => (
        m.id !== targetAssistantId
          ? m
          : {
              ...m,
              status,
              content: [{ type: 'text', text }],
              ...(metadata ? { metadata } : {}),
            }
      )),
    }))
  }

  if (session.status === 'streaming' && codexCommand.kind === 'run') {
    const steerAssistantId = `codex_${Date.now()}`
    const previousActiveCodexMessageId = session.activeCodexMessageId
    appendAssistant({
      id: steerAssistantId,
      role: 'assistant',
      status: 'streaming',
      content: [],
      createdAt: new Date().toISOString(),
      providerId: 'codex',
    })
    updateCodexSession(() => ({
      status: 'streaming',
      activeCodexMessageId: steerAssistantId,
      codexTurnLastUsage: null,
      streamingTokens: { input: 0, output: 0 },
    }))
    try {
      await window.app.codexSteer(
        codexSessionId,
        codexCommand.prompt,
        steerAssistantId,
        userMessageId,
        finalContent,
        session._gitBranch ?? undefined,
        session._worktreePath ?? undefined,
      )
    } catch (error) {
      updateCodexSession((sess) => ({
        status: 'streaming',
        activeCodexMessageId: previousActiveCodexMessageId ?? null,
        codexTurnLastUsage: previousCodexTurnLastUsage,
        messages: sess.messages.filter((m) => m.id !== steerAssistantId),
      }))
      console.warn('[runCodexCommand] Codex steer failed:', error)
    }
    return
  }

  appendAssistant({
    id: assistantId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
  })
  updateCodexSession(() => ({
    status: 'streaming',
    activeCodexMessageId: assistantId,
    codexTurnLastUsage: null,
    streamingTokens: { input: 0, output: 0 },
  }))

  try {
    const runStart = Date.now()
    const codexCwd = _getSessionCwd(activeProject, session)
    let result: Awaited<ReturnType<typeof window.app.codexRun>>

    if (codexCommand.kind === 'review') {
      result = await window.app.codexReview(
        codexSessionId,
        activeProject,
        codexCommand.target,
        resolvedCodexModel,
        resolvedCodexReasoningEffort,
        selectedCodexPermissionPreset,
        codexThreadId,
        assistantId,
        codexCwd,
        userMessageId,
        finalContent,
        session._gitBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    } else if (codexCommand.kind === 'compact') {
      result = await window.app.codexCompact(
        codexSessionId,
        activeProject,
        resolvedCodexModel,
        selectedCodexPermissionPreset,
        codexThreadId,
        assistantId,
        codexCwd,
        userMessageId,
        finalContent,
        session._gitBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    } else {
      result = await window.app.codexRun(
        codexSessionId,
        activeProject,
        codexCommand.prompt,
        resolvedCodexModel,
        resolvedCodexReasoningEffort,
        selectedCodexPermissionPreset,
        collaborationMode,
        codexThreadId,
        assistantId,
        attachments.length > 0 ? attachments : undefined,
        codexCwd,
        userMessageId,
        finalContent,
        session._gitBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    }

    const text = result.finalResponse?.trim() || (
      codexCommand.kind === 'compact'
        ? 'Conversation compacted.'
        : 'Codex completed without returning text.'
    )
    const renderedItems = pruneTransientCodexItems(result.items)
    const codexSession = getCodexSession()
    const footerTokens = result.usage && codexSession
      ? accumulateCodexFooterTokens(codexSession.streamingTokens, result.usage, codexSession.codexTurnLastUsage)
      : codexSession?.streamingTokens ?? { input: 0, output: 0 }
    const consumedTokens = footerTokens.input > 0 || footerTokens.output > 0 ? footerTokens : undefined
    updateAssistant('complete', text, result.usage ? {
      durationMs: Date.now() - runStart,
      usage: {
        inputTokens: result.usage.lastInputTokens,
        outputTokens: result.usage.lastOutputTokens,
        cacheReadInputTokens: result.usage.lastCachedInputTokens,
        cacheCreationInputTokens: 0,
      },
      ...(consumedTokens ? { consumedTokens } : {}),
      codex: {
        threadId: result.threadId,
        usage: result.usage,
        items: renderedItems,
      },
    } : {
      durationMs: Date.now() - runStart,
      codex: {
        threadId: result.threadId,
        usage: null,
        items: renderedItems,
      },
    }, {
      contextTokens: result.usage
        ? (() => {
            const total = getCodexContextTokens(result.usage)
            return total > 0 ? total : (codexSession?.contextTokens ?? 0)
          })()
        : (codexSession?.contextTokens ?? 0),
      contextWindow: result.usage?.contextWindow && result.usage.contextWindow > 0
        ? result.usage.contextWindow
        : (codexSession?.contextWindow ?? null),
      codexUsageSnapshot: result.usage ?? codexSession?.codexUsageSnapshot ?? null,
      codexTurnLastUsage: null,
      streamingTokens: { input: 0, output: 0 },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const interrupted = /interrupt|abort/i.test(message)
    updateAssistant(
      interrupted ? 'interrupted' : 'error',
      interrupted ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
      undefined,
      { codexTurnLastUsage: null, streamingTokens: { input: 0, output: 0 } },
    )
  }

  const finalCodexSession = getCodexSession()
  if (finalCodexSession) {
    const currentProject = getProject(get(), activeProject)
    if (currentProject._activeSessionId !== codexSessionId) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              unseenCompletedSessions: new Set([...proj.unseenCompletedSessions, codexSessionId]),
            },
          },
        }
      })
    }
  }
}
