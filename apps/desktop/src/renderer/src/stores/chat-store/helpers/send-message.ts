import { sendRemoteMessageImpl } from './send-message-remote'
import { createSendWriteScope } from './send-write-scope'
import { shouldInterceptHostSlash } from './send-command-policy'
import { codexAccountId, isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { isCompactSlashSend } from '@superone/shared/compact-boundary'
import type { ChatMessage, ContentBlock, ImageAttachment } from '@superone/shared/agent-types'
import { pendingSlashCommandFrom } from '@superone/chat-core'
import { newMessageId } from '@superone/shared/message-id'
import { buildBrowserAnnotationText } from './browser-annotation'
import { runCodexCommand } from '../codex/runner'
import { createDefaultPerSessionState, createSessionId, freshSubagentColorPool } from '../defaults'
import { createLocalTextUserMessage, formatCodexLoginStart, isRunnableCodexCommand, parseCodexCommand, resolveSessionCodexSelection, type CodexCommand } from './codex-helpers'
import { _ensureClaudeSessionReadyForSend, resetLock, type ChatStoreSet } from './lifecycle'
import { _getEffectiveSessionId } from './persistence'
import { applyCachedCodexPermissionPreset } from './prefs-cache'
import { commitPerSession, getProject, getScopedPerSession, mergeCallerScopedDirs } from './store-helpers'
import { isControlledElsewhere } from './remote-control'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { CLAUDE_INTERCEPTED_COMMANDS, isRemoteSession } from '../index'
import type { ChatProvider, ChatStore, InputSegment, Mention, SessionWriteTarget } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { expandPathRefTagsForAgent } from '@superone/shared/miniapp-prompt-tags'
import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { sessionSendRequest, shouldQueueUserSend } from './session-send-request'
import { deliverUserSend } from './send-replay'
import { resolveEffectiveProviderId } from '@/lib/provider-resolve'

async function isOfficialCodexProvider(apiProviderId: string | null): Promise<boolean> {
  if (isCodexAccountProvider(apiProviderId)) return true
  if (apiProviderId) return false
  // Settings imports the chat store, so resolve it lazily to avoid a module-init cycle.
  const { useSettingsStore } = await import('../../settings')
  const { platforms, credentials, bindings } = useSettingsStore.getState()
  return resolveEffectiveProviderId(
    platforms,
    credentials,
    bindings,
    'chat:codex',
    apiProviderId,
  ) === null
}

/**
 * Body of useChatStore.sendMessage extracted as a free-standing helper so
 * the store action stays a one-line dispatcher. Drives one full send turn:
 * - worktree activation when a pending base-branch is queued
 * - context/quote/miniapp-reminder suffix assembly
 * - provider resolution (claude vs codex) + codex slash-command parsing
 * - rotate SuperOne session id when first switching an empty draft to codex
 * - utility codex commands (reset/login/logout/plan) routed to the popup
 * - intercepted slash commands (/provider, /clear, /mcp, Grok /recap)
 * - user message appended (or queued during a claude streaming turn)
 * - dispatch: codex → runCodexCommand, claude → window.agent.sendMessage
 *
 * Optional `target` pins the send to a mosaic-tile (or other scoped) session so a
 * project-active pointer that has not yet flipped cannot steal the turn.
 *
 * Returns void; a send the host refuses is marked on its bubble with a replay
 * kept for Resend (see `deliverUserSend`), not re-thrown.
 */
export async function sendMessageImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  content: string,
  segments?: InputSegment[],
  explicitMentions?: Mention[],
  explicitAttachments?: ImageAttachment[],
  target?: SessionWriteTarget,
): Promise<void> {
  const projectPath = target?.projectPath ?? get().activeProject
  if (!projectPath) return

  const writeScope = createSendWriteScope(set, get, projectPath, target)
  const resolveWriteSid = writeScope.sessionId
  const patchSession = writeScope.patch

  const handleCodexAccountCommand = async (
    command: 'login' | 'logout',
    apiProviderId: string | null,
  ): Promise<void> => {
    patchSession(() => ({ _pendingSlashCommand: '' }))
    try {
      const isOfficial = await isOfficialCodexProvider(apiProviderId)
      let popupContent: string
      if (!isOfficial) {
        popupContent = `/${command} is only available with the official OpenAI provider.`
      } else if (command === 'login') {
        popupContent = formatCodexLoginStart(
          await window.app.codexStartAccountLogin(projectPath, codexAccountId(apiProviderId) ?? undefined),
        )
      } else {
        await window.app.codexLogoutAccount(projectPath, apiProviderId)
        popupContent = 'Signed out of ChatGPT.'
      }
      patchSession(() => ({ slashCommandOutput: { command, content: popupContent } }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patchSession((session) => ({
        messages: [...session.messages, {
          id: `slash-error-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `Error: ${message}` }],
          status: 'error',
          createdAt: new Date().toISOString(),
          providerId: 'codex',
        }],
      }))
    }
  }

  // Mobile remote-control lock (another device owns the desktop session) — not node env.
  if (isRemoteSession(get(), projectPath, resolveWriteSid())) return
  // Another computer drives it (main or the node rejects the send); the composer is read-only.
  if (isControlledElsewhere(getScopedPerSession(get(), writeScope.target))) return

  const initialSession = getScopedPerSession(get(), writeScope.target)
  const initialProvider = initialSession.sessionProvider ?? initialSession.preferredProvider
  const initialCodexCommand = initialProvider === 'codex'
    ? parseCodexCommand(content.trim())
    : null
  if (initialCodexCommand?.kind === 'login' || initialCodexCommand?.kind === 'logout') {
    await handleCodexAccountCommand(initialCodexCommand.kind, initialSession.apiProviderId)
    return
  }

  {
    const project = getProject(get(), projectPath)
    const session = getScopedPerSession(get(), writeScope.target)
    window.app.trace?.('session.lifecycle', 'sendMessage', {
      activeSid: project._activeSessionId,
      writeSid: resolveWriteSid(),
      status: session.status,
      provider: session.sessionProvider,
      msgCount: session.messages.length,
      knownSids: Object.keys(project._sessions),
    })
  }

  // Remote node project: route through EnvironmentHost → CLI session.send (lease handled in Main).
  const remoteKey = parseRemoteProjectKey(projectPath)
  if (remoteKey) {
    return sendRemoteMessageImpl(set, get, projectPath, remoteKey, content, writeScope, segments, explicitMentions, explicitAttachments)
  }

  const { useAppStore } = await import('../../app')
  const wtState = useAppStore.getState().getWorktreeState(projectPath)
  if (wtState.pendingBaseBranch) {
    const baseBranch = wtState.pendingBaseBranch
    const mode = wtState.pendingMode
    const branchName = wtState.pendingBranchName.trim()
    if (mode === 'branch' && !branchName) {
      console.error('[sendMessage] Branch mode requires a branch name')
      return
    }
    const result = await window.app.activateWorktree(projectPath, {
      baseBranch,
      mode,
      branchName: mode === 'branch' ? branchName : undefined,
      carryLocalChanges: wtState.pendingCarryLocalChanges,
    })
    if (!result.ok) {
      console.error('[sendMessage] Failed to activate worktree:', result.error)
      return
    }
    useAppStore.getState().setActiveWorktree(projectPath, result.path)
    const recordedBranch = mode === 'branch' ? branchName : baseBranch
    patchSession(() => ({
      cwd: result.path,
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      session: null,
      sessionProvider: null,
      _gitBranch: recordedBranch,
      _worktreePath: result.path,
      todos: {},
      _nextTodoId: 1,
      showTodos: false,
      _todosUserDismissed: false,
      subagentTokens: {},
      subagentColors: {},
      _subagentColorsFree: freshSubagentColorPool(),
    }))
  }

  const session = getScopedPerSession(get(), writeScope.target)
  const project = getProject(get(), projectPath)
  const {
    preferredProvider,
    selectedModel,
    selectedEffort,
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexPermissionPreset,
    selectedCodexCollaborationMode,
  } = session
  const annotations = session.browserAnnotations ?? []
  const annotationImages: ImageAttachment[] = annotations
    .filter((a) => a.screenshot)
    .map((a) => ({ mimeType: 'image/png', base64: a.screenshot as string, name: `annotation-${a.id}.png` }))
  // Prefer the doc-ordered attachments the composer collected from its editor
  // nodes; fall back to session state for non-editor callers (e.g. remote commands).
  const userAttachments = explicitAttachments ?? session.attachments
  const attachments: ImageAttachment[] = [...userAttachments, ...annotationImages]
  const annotationSuffix = annotations.length > 0
    ? '\n\n' + annotations.map(buildBrowserAnnotationText).join('\n\n')
    : ''
  const mentions: Mention[] = explicitMentions ?? session.mentions

  const rawContent = content.trim()
  const activeContexts = Object.values(session.miniAppContexts).filter(
    (slot) => slot.mode === 'inject' || slot.checked,
  )
  const contextSuffix = activeContexts.length > 0
    ? '\n\n' + activeContexts.map((ctx) => `<app-context app="${ctx.appName}" summary="${ctx.summary}">\n${ctx.content}\n</app-context>`).join('\n\n')
    : ''
  const userSelections = session.userSelections
  let quoteSuffix = ''
  if (userSelections.length === 1) {
    quoteSuffix = `\n\n<quote>\n${userSelections[0]}\n</quote>`
  } else if (userSelections.length > 1) {
    const inner = userSelections
      .map((s, i) => `<quote${i + 1}>\n${s}\n</quote${i + 1}>`)
      .join('\n')
    quoteSuffix = `\n\n<quote>\n${inner}\n</quote>`
  }
  const requestedProvider: ChatProvider =
    preferredProvider === 'codex'
    || preferredProvider === 'acp'
    || preferredProvider === 'opencode'
    || preferredProvider === 'cursor'
      ? preferredProvider
      : 'claude'
  const effectiveProvider: ChatProvider = session.sessionProvider ?? requestedProvider
  // @codex / @grok — the agent id is already decided, so the reminder pins it
  // and tells the model to skip session_collab_list_agents entirely.
  let agentReminderSuffix = ''
  const agentMentions = mentions.filter((m) => m.kind === 'agent-profile' && m.value)
  if (agentMentions.length > 0) {
    const { decodeAgentRef, formatAgentMentionReminder } = await import(
      '@superone/shared/agent-mention-tags'
    )
    agentReminderSuffix = formatAgentMentionReminder(
      agentMentions.flatMap((m) => {
        const decoded = decodeAgentRef(m.value)
        if (!decoded) return []
        return [{ displayName: m.displayName || decoded.providerId, providerId: decoded.providerId }]
      }),
    )
  }

  let miniAppReminderSuffix = ''
  const miniAppMentions = mentions.filter((m) => m.kind === 'miniapp')
  if (miniAppMentions.length > 0) {
    const { useMiniAppStore } = await import('../../miniapp')
    const apps = useMiniAppStore.getState().apps
    const lines: string[] = [
      'User mentioned these mini-app(s); their MCP tools are authorized — prefer them when relevant:',
    ]
    for (const m of miniAppMentions) {
      const app = apps.find((a) => a.id === m.value)
      const manifest = app?.manifest
      const name = manifest?.name ?? m.displayName
      const appId = app?.id ?? m.value
      const tools = manifest?.tools ?? []
      // Fixed surface: miniapp_list / miniapp_call. Agents discover tools via miniapp_list.
      if (effectiveProvider === 'codex' && tools.length > 0) {
        const toolNames = tools.map((t) => t.name).join(', ')
        lines.push(
          `- "${name}" (appId="${appId}"): call mcp__superone.miniapp_call with tool in [${toolNames}] (use miniapp_list first if unsure)`,
        )
      } else {
        lines.push(
          `- "${name}" (appId="${appId}"): use mcp__superone__miniapp_call with this appId; call miniapp_list for tool names/schemas`,
        )
      }
    }
    miniAppReminderSuffix = `\n\n<superone-miniapp-reminder>\n${lines.join('\n')}\n</superone-miniapp-reminder>`
  }
  let sessionReminderSuffix = ''
  const sessionMentions = mentions.filter((m) => m.kind === 'session' && m.value)
  if (sessionMentions.length > 0) {
    const lines: string[] = [
      'User @-mentioned SuperOne session archive(s). Use SuperOne MCP session tools with the SuperOne sessionId (NOT provider/harness session ids):',
      '- session_read({ sessionId, view: "meta" | "user" | "assistant" | "text" | "tools" })',
      '- session_search / session_list when you need to locate messages first',
      'Prefer progressive views; do not dump entire transcripts into context.',
    ]
    const seen = new Set<string>()
    for (const m of sessionMentions) {
      if (!m.value || seen.has(m.value)) continue
      seen.add(m.value)
      lines.push(`- "${m.displayName || m.value}" (sessionId: ${m.value})`)
    }
    sessionReminderSuffix = `\n\n<superone-session-reminder>\n${lines.join('\n')}\n</superone-session-reminder>`
  }
  let capabilityReminderSuffix = ''
  let desktopAppReminderSuffix = ''
  // Expand popup-selected path/agent tags to bare @value for the model; keep
  // the stored user bubble as structured tags so only those render as chips.
  let agentContent = expandPathRefTagsForAgent(rawContent)
  // CLI-style `/workflow name key=value` → JSON object for the agent (Grok expects JSON or free text).
  if (/^\/workflow\s+\S+/i.test(agentContent)) {
    const { rewriteWorkflowCommandForAgent } = await import(
      '../../../components/chat/workflow-cli-args'
    )
    const { getWorkflowArgSpecs } = await import(
      '../../../components/chat/workflow-arg-specs-cache'
    )
    agentContent = rewriteWorkflowCommandForAgent(agentContent, getWorkflowArgSpecs)
  }
  const capabilityMentions = mentions.filter((m) => isBuiltinCapabilityId(m.kind))
  const desktopAppMentions = mentions.filter((m) => m.kind === 'desktop-app')
  if (capabilityMentions.length > 0) {
    const {
      CAPABILITY_TAG_REGEX,
      getBuiltinCapability,
      wrapCapabilityMention,
      formatCapabilityReminderLine,
      isBuiltinCapabilityId,
    } = await import('@superone/shared/capability-prompt-tags')
    // Agent-facing payload always uses English capability labels, even when the
    // user bubble keeps a localized chip name in the stored user message.
    agentContent = agentContent.replace(CAPABILITY_TAG_REGEX, (full, _name, id) => {
      const capId = String(id).trim()
      if (!isBuiltinCapabilityId(capId)) return full
      return wrapCapabilityMention(capId)
    })
    const lines: string[] = [
      'User mentioned built-in capabilities; prefer these MCP tools when relevant:',
    ]
    // Dedupe by kind — selecting the same chip twice should not double the hint.
    const seen = new Set<string>()
    for (const m of capabilityMentions) {
      if (seen.has(m.kind)) continue
      seen.add(m.kind)
      const cap = getBuiltinCapability(m.kind)
      if (!cap) continue
      lines.push(formatCapabilityReminderLine(cap, effectiveProvider === 'codex' ? 'codex' : 'claude'))
    }
    capabilityReminderSuffix = `\n\n<superone-capability-reminder>\n${lines.join('\n')}\n</superone-capability-reminder>`
  }
  // Reminder is filled only after grant IPC succeeds (see below near authorize).
  let pendingDesktopAppReminder = ''
  if (desktopAppMentions.length > 0) {
    const lines: string[] = [
      'User @-mentioned these installed desktop apps. Computer Use is temporarily authorized for them for this session — do NOT request another grant for these bundle ids.',
      'Prefer computer_* tools when interacting with them:',
    ]
    const seen = new Set<string>()
    for (const m of desktopAppMentions) {
      if (!m.value || seen.has(m.value)) continue
      seen.add(m.value)
      lines.push(`- "${m.displayName || m.value}" (bundleId: ${m.value})`)
    }
    if (!capabilityMentions.some((m) => m.kind === 'computer')) {
      lines.push(
        'Tools start with "mcp__superone__computer_" (Claude) or "mcp__superone.computer_" (Codex).',
      )
    }
    pendingDesktopAppReminder = `\n\n<superone-desktop-app-reminder>\n${lines.join('\n')}\n</superone-desktop-app-reminder>`
  }
  // MCP server items: the host reads their text now so the model need not call a tool for it.
  // No session yet means no server answered a search either, so there is nothing to read.
  const mcpMentionSid = resolveWriteSid()
  const mcpResourceSuffix = mcpMentionSid && mentions.some((m) => m.kind === 'mcp-resource')
    ? await import('../../../components/mcp-apps/mention-content').then(({ mcpMentionContentForModel }) =>
      mcpMentionContentForModel(projectPath, mcpMentionSid, mentions))
    : ''
  // desktop-app reminder is appended only after grant IPC succeeds (below).
  let finalContent =
    agentContent +
    contextSuffix +
    quoteSuffix +
    miniAppReminderSuffix +
    sessionReminderSuffix +
    agentReminderSuffix +
    capabilityReminderSuffix +
    mcpResourceSuffix +
    annotationSuffix
  const codexCommand = parseCodexCommand(rawContent)
  // Note: codex command is re-built after grant if desktop-app reminder is added.
  let resolvedCodexCommand: CodexCommand | null = effectiveProvider === 'codex'
    ? (codexCommand ?? { kind: 'run', prompt: finalContent })
    : null
  const resolvedCodexSelection = resolveSessionCodexSelection(
    project.codexModels,
    selectedCodexModel,
    selectedCodexReasoningEffort,
  )
  // The selection shown by the picker already includes configured defaults.
  // User-chosen flags control whether later preference changes may update this
  // session; they must not decide which model/effort the current turn uses.
  const resolvedCodexModel = resolvedCodexSelection.modelId || undefined
  const resolvedCodexReasoningEffort = resolvedCodexSelection.reasoningEffort
  const isCodexDurableQueueSend = effectiveProvider === 'codex'
    && session.status === 'streaming'
    && resolvedCodexCommand?.kind === 'run'
  const isQueuedSend = shouldQueueUserSend(effectiveProvider, session.status, isCodexDurableQueueSend)

  if (!session.sessionProvider) {
    patchSession(() => ({
      sessionProvider: effectiveProvider,
      preferredProvider: effectiveProvider,
    }))
  }

  // Promote empty drafts to Codex in place (same SuperOne sid). Main dispose+
  // recreate on send/prewarm handles harness mismatch. Only mint a new sid when
  // carrying a non-empty non-Codex transcript into a Codex first turn.
  if (effectiveProvider === 'codex' && session.sessionProvider !== 'codex') {
    const previousSid = resolveWriteSid()
    const currentSess = previousSid
      ? getProject(get(), projectPath)._sessions[previousSid]
      : null
    if (currentSess && currentSess.messages.length === 0) {
      set((s) => {
        const proj = getProject(s, projectPath)
        const sid = previousSid
        if (!sid || !proj._sessions[sid]) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...proj,
              _sessions: {
                ...proj._sessions,
                [sid]: {
                  ...proj._sessions[sid],
                  sessionProvider: 'codex',
                  preferredProvider: 'codex',
                  _providerSessionId: null,
                },
              },
            },
          },
        }
      })
      if (previousSid && typeof window.agent?.resetSession === 'function') {
        void window.agent.resetSession(previousSid).catch(() => {})
      }
    } else {
      const nextSid = createSessionId()
      set((s) => {
        const proj = getProject(s, projectPath)
        const currentSid = previousSid
        const nextSessions = { ...proj._sessions }
        nextSessions[nextSid] = {
          ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()),
          cwd: currentSess?.cwd ?? '',
          sessionProvider: 'codex',
          preferredProvider: 'codex',
        }
        const nextActive = currentSid && proj._activeSessionId === currentSid
          ? nextSid
          : proj._activeSessionId
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...proj,
              _activeSessionId: nextActive,
              _sessions: nextSessions,
            },
          },
        }
      })
      if (writeScope.target && previousSid) {
        writeScope.target = { projectPath, sessionId: nextSid }
        void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
          useMosaicStore.getState().replaceTileSession(projectPath, previousSid, nextSid)
        }).catch(() => {})
      } else if (writeScope.target) {
        writeScope.target = { projectPath, sessionId: nextSid }
      }
    }
  }

  patchSession(() => ({ _pendingSlashCommand: pendingSlashCommandFrom(finalContent) }))

  const codexSessionId = resolvedCodexCommand
    ? (writeScope.target?.sessionId ?? _getEffectiveSessionId(getProject(get(), projectPath)))
    : null

  // Utility codex commands → popup (no chat messages); errors fall through to in-chat assistant error message
  if (resolvedCodexCommand) {
    const utilityKind = resolvedCodexCommand.kind
    if (utilityKind === 'reset' || utilityKind === 'login' || utilityKind === 'logout' || utilityKind === 'plan' || utilityKind === 'review-picker') {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      try {
        let popupContent: string
        if (utilityKind === 'review-picker') {
          get().setShowReviewPanel(true, resolvedCodexCommand.mode)
          return
        } else if (utilityKind === 'reset') {
          if (codexSessionId) await window.agent.resetSession(codexSessionId)
          popupContent = 'Codex thread has been reset.'
        } else if (utilityKind === 'login' || utilityKind === 'logout') {
          await handleCodexAccountCommand(utilityKind, session.apiProviderId)
          return
        } else if (utilityKind === 'plan') {
          get().setSelectedCodexCollaborationMode('plan')
          return
        }
        patchSession(() => ({
          slashCommandOutput: { command: utilityKind, content: popupContent },
        }))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const errorMsg: ChatMessage = {
          id: `slash-error-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `Error: ${msg}` }],
          status: 'error',
          createdAt: new Date().toISOString(),
          providerId: 'codex',
        }
        patchSession((sess) => ({
          messages: [...sess.messages, errorMsg],
        }))
      }
      return
    }
  }

  // /provider command retired — provider selection moved into the model selector (kept for reference)
  // {
  //   const providerMatch = rawContent.match(/^\/provider$/)
  //   if (providerMatch) {
  //     patchSession(() => ({ _pendingSlashCommand: '' }))
  //     useChatStore.getState().openProviderPopup()
  //     return
  //   }
  // }

  if (effectiveProvider === 'claude' || effectiveProvider === 'cursor') {
    const m = rawContent.match(/^\/(\S+)$/)
    if (m && shouldInterceptHostSlash(effectiveProvider, m[1]!)) {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      await CLAUDE_INTERCEPTED_COMMANDS[m[1]!]!()
      return
    }
  }

  // Host-only `/workflows` and `/mcp` for Grok/ACP (same popups as Claude; never a prompt turn).
  if (effectiveProvider === 'acp' && /^\/(workflows|mcp)$/.test(rawContent)) {
    const name = rawContent.slice(1) as 'workflows' | 'mcp'
    patchSession(() => ({ _pendingSlashCommand: '' }))
    await CLAUDE_INTERCEPTED_COMMANDS[name]!()
    return
  }

  // Grok ACP: intercept `/recap` → x.ai/recap (auto=false), not a prompt turn.
  if (effectiveProvider === 'acp' && isGrokAcpAgent(session.acpAgentId)) {
    if (/^\/recap$/.test(rawContent)) {
      patchSession(() => ({ _pendingSlashCommand: '', isRecapping: true }))
      const sid = resolveWriteSid()
      if (sid) {
        try {
          const ok = await window.agent.requestSessionRecap(sid)
          if (!ok) patchSession(() => ({ isRecapping: false }))
        } catch {
          patchSession(() => ({ isRecapping: false }))
        }
      } else {
        patchSession(() => ({ isRecapping: false }))
      }
      return
    }
  }

  const attachmentBlock = (att: ImageAttachment): ContentBlock =>
    att.mimeType === 'application/pdf'
      ? { type: 'document' as const, name: att.name, id: att.id }
      : { type: 'image' as const, name: att.name, id: att.id }

  // When the composer supplies ordered segments, interleave text and attachment
  // blocks so the sent message preserves each chip's inline position. Browser
  // annotation screenshots have no inline anchor, so they trail at the end.
  const hasInlineAttachments = !!segments?.some((s) => 'attachmentId' in s)
  const userContent: ContentBlock[] = hasInlineAttachments
    ? [
        ...segments!.flatMap((seg): ContentBlock[] => {
          if ('attachmentId' in seg) {
            const att = userAttachments.find((a) => a.id === seg.attachmentId)
            return att ? [attachmentBlock(att)] : []
          }
          return seg.text ? [{ type: 'text' as const, text: seg.text, isPaste: seg.isPaste }] : []
        }),
        ...annotationImages.map(attachmentBlock),
      ]
    : [
        ...attachments.map(attachmentBlock),
        ...(segments && segments.length > 0
          ? segments.flatMap((s) => ('attachmentId' in s ? [] : [{ type: 'text' as const, text: s.text, isPaste: s.isPaste }]))
          : rawContent ? [{ type: 'text' as const, text: rawContent }] : []),
      ]

  // Keep what the host read for mentioned MCP resources with the message, so its
  // chips can show what the agent got. The bubble and copy text strip the block.
  if (mcpResourceSuffix) userContent.push({ type: 'text', text: mcpResourceSuffix.trim() })

  const userMessageId = newMessageId('user')
  const messageContexts = activeContexts.length > 0
    ? activeContexts.map((ctx) => ({ appId: ctx.appId, appName: ctx.appName, summary: ctx.summary, content: ctx.content, color: ctx.color }))
    : undefined
  const userMessage: ChatMessage = {
    ...createLocalTextUserMessage(userMessageId, rawContent),
    content: userContent,
    attachments: attachments.length > 0 ? attachments : undefined,
    contexts: messageContexts,
    userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
  }
  const isCompactSlash = isCompactSlashSend(effectiveProvider, finalContent)
  const awaitsReply = (effectiveProvider === 'claude' || effectiveProvider === 'acp'
    || effectiveProvider === 'cursor' || effectiveProvider === 'opencode') && !isQueuedSend
  set((s) => ({
    ...commitPerSession(s, writeScope.target, (sess) => ({
      ...(!isQueuedSend ? { messages: [...sess.messages, userMessage] } : {}),
      ...(isQueuedSend ? { queuedMessages: [...sess.queuedMessages, userMessage] } : {}),
      attachments: [],
      browserAnnotations: [],
      mentions: [],
      miniAppContexts: {},
      userSelections: [],
      codexPlanRejectHintActive: false,
      additionalDirsDirty: false,
      draftId: null,
      ...(isCompactSlash ? { _pendingCompactUserId: userMessageId } : {}),
      ...(awaitsReply ? { awaitingAssistantReply: true } : {}),
      ...(effectiveProvider === 'cursor' && !isQueuedSend
        ? { status: 'streaming' as const }
        : {}),
    })),
    isOpen: true,
  }))
  // First send consumes any visibility/leave-promoted draft for this origin.
  {
    const consumeSid = resolveWriteSid()
    if (consumeSid) {
      void import('./draft-promote').then(({ consumeDraftForSession }) => {
        void consumeDraftForSession(projectPath, consumeSid)
      })
    }
  }

  if (activeContexts.length > 0) {
    const consumedAppIds = activeContexts.map((c) => c.appId)
    window.dispatchEvent(new CustomEvent('miniapp-context-consumed', { detail: { appIds: consumedAppIds } }))
  }

  if (resetLock.current) await resetLock.current

  // Re-read the write session id from the live store when unscoped. A first-turn
  // codex switch above assigns a fresh _activeSessionId via set(), which the
  // snapshot at the top of this function does NOT reflect — using that stale
  // value here silently skipped mini-app tool authorization on the very first
  // codex @-mention. Scoped sends track rotations on writeScope.target instead.
  const resolvedSessionId = writeScope.target?.sessionId
    ?? getProject(get(), projectPath)._activeSessionId
    ?? undefined

  // Authorize @-mentioned mini-app tools for this session BEFORE dispatching the turn.
  // Codex dispatches via runCodexCommand and returns below, so authorizing after that
  // block would never run for codex (this is why codex never loaded @-mentioned tools).
  const miniAppAuthorizations = mentions
    .filter((m) => m.kind === 'miniapp')
    .map((m) => m.value)
  if (miniAppAuthorizations.length > 0 && resolvedSessionId) {
    try {
      await window.miniapp.authorize(miniAppAuthorizations, projectPath, resolvedSessionId)
    } catch (err) {
      console.error('[sendMessage] miniapp authorize failed:', err)
    }
  }

  // Temporary Computer Use grants from @ desktop-app mentions (session-scoped, no HITL).
  const desktopAppGrants = mentions
    .filter((m) => m.kind === 'desktop-app' && m.value)
    .map((m) => ({ app: m.displayName || m.value, bundleId: m.value }))
  if (desktopAppGrants.length > 0 && resolvedSessionId && window.app?.grantComputerUseSessionApps) {
    try {
      const ok = await window.app.grantComputerUseSessionApps(
        resolvedSessionId,
        desktopAppGrants,
      )
      if (ok && pendingDesktopAppReminder) {
        finalContent += pendingDesktopAppReminder
        if (effectiveProvider === 'codex' && resolvedCodexCommand?.kind === 'run') {
          resolvedCodexCommand = { kind: 'run', prompt: finalContent }
        }
      }
    } catch (err) {
      console.error('[sendMessage] computer-use session grant failed:', err)
    }
  }

  if (resolvedCodexCommand && !isCodexDurableQueueSend) {
    if (!isRunnableCodexCommand(resolvedCodexCommand) || !codexSessionId) return
    await runCodexCommand(set, get, {
      activeProject: projectPath,
      codexSessionId,
      session,
      codexCommand: resolvedCodexCommand,
      finalContent,
      userMessageId,
      attachments,
      selectedCodexPermissionPreset,
      collaborationMode: selectedCodexCollaborationMode,
      resolvedCodexModel,
      resolvedCodexReasoningEffort,
      userMessageContent: userContent,
      contexts: messageContexts,
      userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
    })
    return
  }

  if (effectiveProvider === 'claude') {
    await _ensureClaudeSessionReadyForSend(get, projectPath, resolvedSessionId)
  }

  const liveSession = getScopedPerSession(get(), writeScope.target)
  const mergedDirs = mergeCallerScopedDirs(project, liveSession)

  const request = sessionSendRequest({
    session: liveSession,
    sessionId: resolvedSessionId,
    provider: effectiveProvider,
    content: finalContent,
    clientMessageId: userMessageId,
    additionalDirs: mergedDirs,
    model: effectiveProvider === 'codex' ? resolvedCodexModel : selectedModel || undefined,
    effort: selectedEffort,
    reasoningEffort: resolvedCodexReasoningEffort,
    images: attachments.length > 0 ? attachments : undefined,
    userMessageContent: userContent,
    contexts: messageContexts,
    userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
    queued: isQueuedSend,
  })
  await deliverUserSend({
    messageId: userMessageId,
    patchSession,
    deliver: async () => { await window.agent.sendMessage(projectPath, request) },
    retryState: () => ({
      ...(awaitsReply ? { awaitingAssistantReply: true } : {}),
      ...(effectiveProvider === 'cursor' && !isQueuedSend ? { status: 'streaming' as const } : {}),
    }),
  })
}
