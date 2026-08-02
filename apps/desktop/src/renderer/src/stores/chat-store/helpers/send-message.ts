import type {
  ChatMessage,
  ContentBlock,
  ImageAttachment,
} from '@superone/shared/agent-types'
import { buildBrowserAnnotationText } from './browser-annotation'
import { runCodexCommand } from '../codex/runner'
import { createDefaultPerSessionState, createSessionId, freshSubagentColorPool } from '../defaults'
import {
  createLocalTextUserMessage,
  formatCodexAuthStatus,
  getCodexHelpText,
  isRunnableCodexCommand,
  parseCodexCommand,
  resolveSessionCodexSelection,
  type CodexCommand,
} from './codex-helpers'
import { _ensureClaudeSessionReadyForSend, resetLock, type ChatStoreSet } from './lifecycle'
import { _getEffectiveSessionId } from './persistence'
import { applyCachedCodexPermissionPreset } from './prefs-cache'
import {
  commitPerSession,
  getProject,
  getScopedPerSession,
  mergeProjectAndSessionDirs,
} from './store-helpers'
import { CLAUDE_INTERCEPTED_COMMANDS, isRemoteSession } from '../index'
import type { ChatProvider, ChatStore, InputSegment, Mention, SessionWriteTarget } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  nodeHarnessToProviderId,
  nodeStatusToAgentStatus,
  transcriptToChatMessages,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'

/**
 * Body of useChatStore.sendMessage extracted as a free-standing helper so
 * the store action stays a one-line dispatcher. Drives one full send turn:
 * - worktree activation when a pending base-branch is queued
 * - context/quote/miniapp-reminder suffix assembly
 * - provider resolution (claude vs codex) + codex slash-command parsing
 * - rotate SuperOne session id when first switching an empty draft to codex
 * - utility codex commands (help/reset/auth-status/auth-set/plan) routed to the popup
 * - intercepted slash commands (/provider, /clear, /mcp)
 * - user message appended (or queued during a claude streaming turn)
 * - dispatch: codex → runCodexCommand, claude → window.agent.sendMessage
 *
 * Optional `target` pins the send to a mosaic-tile (or other scoped) session so a
 * project-active pointer that has not yet flipped cannot steal the turn.
 *
 * Returns void; failures inside the IPC call are re-thrown after rolling back
 * the awaitingAssistantReply flag (when not in queued mode).
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

  // Mutable write target: codex first-turn may rotate the session id under us.
  let writeTarget: SessionWriteTarget | undefined = target
    ? { projectPath: target.projectPath, sessionId: target.sessionId }
    : undefined

  const resolveWriteSid = (): string | null => {
    if (writeTarget) return writeTarget.sessionId
    return getProject(get(), projectPath)._activeSessionId
  }

  const patchSession = (updater: (s: ReturnType<typeof getScopedPerSession>) => Partial<ReturnType<typeof getScopedPerSession>>) => {
    set((s) => commitPerSession(s, writeTarget, updater))
  }

  // Mobile remote-control lock (another device owns the desktop session) — not node env.
  if (isRemoteSession(get(), projectPath, resolveWriteSid())) return

  {
    const project = getProject(get(), projectPath)
    const session = getScopedPerSession(get(), writeTarget)
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
    const text = content.trim()
    if (!text) return

    // SuperOne-local slash intercepts (same as local path) — never forward to node.
    // Match bare `/clear` etc.; args form is not used by CLAUDE_INTERCEPTED_COMMANDS today.
    {
      const m = text.match(/^\/(\S+)$/)
      if (m && CLAUDE_INTERCEPTED_COMMANDS[m[1]!]) {
        patchSession(() => ({ _pendingSlashCommand: '' }))
        await CLAUDE_INTERCEPTED_COMMANDS[m[1]!]!()
        return
      }
    }

    const { useAppStore } = await import('../../app')
    let projectId = useAppStore.getState().currentProjectId
    // Recover node projectId if mirror lost it (host switch race, HMR, etc.).
    if (!projectId) {
      try {
        const listed = await window.environment.listProjects(remoteKey.connectionId)
        const rows = Array.isArray(listed) ? listed : []
        const match = rows.find(
          (p: { path?: string; projectId?: string }) =>
            (p.path || '').replace(/\/$/, '') === remoteKey.path.replace(/\/$/, ''),
        )
        projectId = match?.projectId ?? null
        if (projectId) useAppStore.setState({ currentProjectId: projectId })
      } catch {
        /* fall through */
      }
    }
    if (!projectId) {
      throw new Error(
        'Remote project is not registered (missing projectId). Re-open the project on this host.',
      )
    }

    // Pending worktree create (branch/attach/detach) — same as local, but IPC hits node.
    const wtState = useAppStore.getState().getWorktreeState(projectPath)
    if (wtState.pendingBaseBranch) {
      const baseBranch = wtState.pendingBaseBranch
      const mode = wtState.pendingMode
      const branchName = wtState.pendingBranchName.trim()
      if (mode === 'branch' && !branchName) {
        throw new Error('Branch mode requires a branch name')
      }
      const act = await window.app.activateWorktree(projectPath, {
        baseBranch,
        mode,
        branchName: mode === 'branch' ? branchName : undefined,
        carryLocalChanges: wtState.pendingCarryLocalChanges,
      })
      if (!act.ok) {
        throw new Error(act.error || 'Failed to activate remote worktree')
      }
      useAppStore.getState().setActiveWorktree(projectPath, act.path)
      const recordedBranch = mode === 'branch' ? branchName : baseBranch
      patchSession(() => ({
        messages: [],
        _gitBranch: recordedBranch,
        _worktreePath: act.path,
        sessionProvider: null,
      }))
    }

    // Local draft UUIDs from ensureSession never exist on the node — materialize first.
    const candidateSid = resolveWriteSid()
    const existingSess = candidateSid
      ? getScopedPerSession(get(), writeTarget ?? { projectPath, sessionId: candidateSid })
      : getScopedPerSession(get(), writeTarget)
    // Node Stage 5: claude + codex. Honor UI tab; default claude (never force codex).
    const uiProvider =
      existingSess.sessionProvider ?? existingSess.preferredProvider ?? 'claude'
    const preferredHarness: 'claude' | 'codex' =
      uiProvider === 'codex' ? 'codex' : 'claude'
    const { resolveNodeSessionId } = await import('@/lib/remote-session-ops')
    const { createDefaultPerSessionState } = await import('../defaults')
    const resolved = await resolveNodeSessionId(projectPath, projectId, candidateSid, {
      harnessId: preferredHarness,
      providerId: preferredHarness,
    })
    let sid = resolved.sessionId

    // Worktree cwd for the node turn (host path). activePath is remote:<conn>:<host> or host abs.
    const remoteWt = useAppStore.getState().getWorktreeState(projectPath)
    const cwdHostPath = remoteWt.activePath
      ? parseRemoteProjectKey(remoteWt.activePath)?.path ??
        (remoteWt.activePath.startsWith('/') ? remoteWt.activePath : null)
      : null

    if (resolved.created || sid !== candidateSid) {
      const prev = existingSess
      writeTarget = { projectPath, sessionId: sid }
      set((s) => {
        const proj = getProject(s, projectPath)
        const nextSessions = { ...proj._sessions }
        if (candidateSid && candidateSid !== sid) {
          delete nextSessions[candidateSid]
        }
        const base = prev ?? createDefaultPerSessionState()
        // Keep UI model selection when swapping draft UUID → real node session id.
        // If still empty (Claude resources loaded late), apply default now.
        let selectedModel = base.selectedModel
        let selectedEffort = base.selectedEffort
        // Remote models come from the node catalog — do not fill from local harnessResources.
        nextSessions[sid] = {
          ...base,
          sessionProvider: preferredHarness,
          preferredProvider: preferredHarness,
          selectedModel,
          selectedEffort,
          _historyHydrated: true,
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...proj,
              _activeSessionId: sid,
              _sessions: nextSessions,
            },
          },
        }
      })
    } else {
      writeTarget = { projectPath, sessionId: sid }
    }

    const userMessageId = crypto.randomUUID()
    const userMsg = {
      id: userMessageId,
      role: 'user' as const,
      status: 'complete' as const,
      content: [{ type: 'text' as const, text }],
      createdAt: new Date().toISOString(),
      providerId: preferredHarness,
    }
    patchSession((sess) => ({
      messages: [...sess.messages, userMsg],
      awaitingAssistantReply: true,
      status: 'streaming',
    }))

    // UI model selection → node turn (Claude slug or Codex model id).
    const writeSess = getScopedPerSession(get(), writeTarget ?? { projectPath, sessionId: sid })
    const modelForTurn =
      preferredHarness === 'claude'
        ? writeSess.selectedModel || undefined
        : preferredHarness === 'codex'
          ? writeSess.selectedCodexModel || undefined
          : undefined
    // Node-local API credential (not desktop credential store).
    const apiProviderIdForTurn = writeSess.apiProviderId ?? null

    try {
      // Main maps session.events → AgentEvent and pushes via agent:event while
      // the turn is open; projectPath routes those events into this session.
      const finalSnap = (await window.environment.sendSessionMessage(remoteKey.connectionId, {
        sessionId: sid,
        text,
        clientMessageId: userMessageId,
        projectPath,
        providerId: preferredHarness,
        cwdHostPath,
        ...(modelForTurn ? { model: modelForTurn } : {}),
        ...(apiProviderIdForTurn ? { apiProviderId: apiProviderIdForTurn } : {}),
      })) as NodeSessionSnapshot | null
      const providerId = nodeHarnessToProviderId(
        finalSnap?.harnessId || finalSnap?.providerId || preferredHarness,
      )
      // Transcript reconcile is the recovery authority if stream events were missed.
      const messages = transcriptToChatMessages(finalSnap?.transcript, providerId)
      const { nodePendingToPermissionRequest } = await import('@/lib/remote-session-messages')
      const pendingPerm = nodePendingToPermissionRequest(finalSnap?.pendingInteraction)
      const waitingOnPermission = Boolean(pendingPerm)
      const snapTitle =
        typeof finalSnap?.title === 'string' && finalSnap.title.trim()
          ? finalSnap.title.trim()
          : null
      // Prefer node title (auto first-message / rename); fall back to first-user slice.
      const derivedTitle =
        snapTitle ||
        (text.length > 100 ? `${text.slice(0, 100)}…` : text)
      patchSession((sess) => ({
        messages: messages.length > 0 ? messages : sess.messages,
        // Stay "streaming" while a remote permission is pending so the prompt stays live.
        awaitingAssistantReply: waitingOnPermission || finalSnap?.status === 'streaming',
        status: waitingOnPermission
          ? 'streaming'
          : nodeStatusToAgentStatus(finalSnap?.status),
        pendingPermissions: pendingPerm ? [pendingPerm] : [],
        ...(derivedTitle ? { _title: derivedTitle } : {}),
      }))
      // Sidebar SessionTitleAnimated reads agentTitles — keep it in sync without a list re-fetch.
      if (derivedTitle) {
        set((s) => {
          const project = s.projectSessions[projectPath]
          let sessions = project?.sessions
          let sessionsChanged = false
          if (project && Array.isArray(sessions)) {
            sessions = sessions.map((entry) => {
              if (entry.sessionId === sid && entry.title !== derivedTitle) {
                sessionsChanged = true
                return { ...entry, title: derivedTitle }
              }
              return entry
            })
          }
          return {
            agentTitles: { ...s.agentTitles, [sid]: derivedTitle },
            ...(project && sessionsChanged
              ? {
                  projectSessions: {
                    ...s.projectSessions,
                    [projectPath]: { ...project, sessions: sessions! },
                  },
                }
              : {}),
          }
        })
      }
    } catch (err) {
      patchSession(() => ({ awaitingAssistantReply: false, status: 'error' }))
      throw err
    }
    return
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

  const session = getScopedPerSession(get(), writeTarget)
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
    preferredProvider === 'codex' || preferredProvider === 'acp' || preferredProvider === 'opencode' ? preferredProvider : 'claude'
  const effectiveProvider: ChatProvider = session.sessionProvider ?? requestedProvider
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
      const toolSlug = manifest?.toolSlug ?? m.value
      const tools = manifest?.tools ?? []
      // Claude's SDK exposes MCP tools flatly as `mcp__superone__<slug>__<tool>`, so a
      // prefix hint suffices. Codex namespaces them as `mcp__superone.<slug>__<tool>` (dot
      // after the server) and enumerates them unreliably, so list each exact name in that
      // form (descriptions left for the agent's own tool discovery).
      if (effectiveProvider === 'codex' && tools.length > 0) {
        const toolNames = tools.map((t) => `mcp__superone.${toolSlug}__${t.name}`).join(', ')
        lines.push(`- "${name}": ${toolNames}`)
      } else {
        lines.push(`- "${name}": tools start with "mcp__superone__${toolSlug}__"`)
      }
    }
    miniAppReminderSuffix = `\n\n<superone-miniapp-reminder>\n${lines.join('\n')}\n</superone-miniapp-reminder>`
  }
  let capabilityReminderSuffix = ''
  let desktopAppReminderSuffix = ''
  let agentContent = rawContent
  const capabilityMentions = mentions.filter(
    (m) => m.kind === 'collab' || m.kind === 'computer' || m.kind === 'browser',
  )
  const desktopAppMentions = mentions.filter((m) => m.kind === 'desktop-app')
  if (capabilityMentions.length > 0) {
    const {
      CAPABILITY_TAG_REGEX,
      getBuiltinCapability,
      wrapCapabilityMention,
      capabilityToolPrefixClaude,
      capabilityToolPrefixCodex,
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
      const prefix = effectiveProvider === 'codex'
        ? capabilityToolPrefixCodex(cap)
        : capabilityToolPrefixClaude(cap)
      lines.push(`- "${cap.displayName}" (${cap.intent}): tools start with "${prefix}"`)
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
  // desktop-app reminder is appended only after grant IPC succeeds (below).
  let finalContent =
    agentContent +
    contextSuffix +
    quoteSuffix +
    miniAppReminderSuffix +
    capabilityReminderSuffix +
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
  const resolvedCodexModel = resolvedCodexSelection.modelId || undefined
  const resolvedCodexReasoningEffort = resolvedCodexSelection.reasoningEffort
  const isQueuedSend = (effectiveProvider === 'claude' || effectiveProvider === 'acp' || effectiveProvider === 'opencode') && session.status === 'streaming'

  if (!session.sessionProvider) {
    patchSession(() => ({
      sessionProvider: effectiveProvider,
      preferredProvider: effectiveProvider,
    }))
  }

  if (effectiveProvider === 'codex' && session.sessionProvider !== 'codex') {
    const nextSid = createSessionId()
    const previousSid = resolveWriteSid()
    set((s) => {
      const proj = getProject(s, projectPath)
      const currentSid = previousSid
      const currentSess = currentSid ? proj._sessions[currentSid] : null
      const shouldCarryState = currentSess != null && currentSess.messages.length === 0
      const nextSessions = { ...proj._sessions }
      if (shouldCarryState && currentSid) {
        delete nextSessions[currentSid]
        nextSessions[nextSid] = { ...currentSess, sessionProvider: 'codex', preferredProvider: 'codex' }
      } else {
        nextSessions[nextSid] = {
          ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()),
          cwd: currentSess?.cwd ?? '',
          sessionProvider: 'codex',
          preferredProvider: 'codex',
        }
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
    if (writeTarget && previousSid) {
      writeTarget = { projectPath, sessionId: nextSid }
      // Keep mosaic tiles pinned to the live session id when a first-turn codex
      // switch rotates the draft id under a scoped pane.
      void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
        useMosaicStore.getState().replaceTileSession(projectPath, previousSid, nextSid)
      }).catch(() => {})
    } else if (writeTarget) {
      writeTarget = { projectPath, sessionId: nextSid }
    }
  }

  const slashMatch = finalContent.match(/^\/(\S+)/)
  patchSession(() => ({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' }))

  const codexSessionId = resolvedCodexCommand
    ? (writeTarget?.sessionId ?? _getEffectiveSessionId(getProject(get(), projectPath)))
    : null

  // Utility codex commands → popup (no chat messages); errors fall through to in-chat assistant error message
  if (resolvedCodexCommand) {
    const utilityKind = resolvedCodexCommand.kind
    if (utilityKind === 'help' || utilityKind === 'reset' || utilityKind === 'auth-status' || utilityKind === 'auth-set' || utilityKind === 'plan' || utilityKind === 'review-picker') {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      try {
        let popupContent: string
        if (utilityKind === 'review-picker') {
          get().setShowReviewPanel(true, 'branch')
          return
        } else if (utilityKind === 'help') {
          popupContent = getCodexHelpText()
        } else if (utilityKind === 'reset') {
          if (codexSessionId) await window.agent.resetSession(codexSessionId)
          popupContent = 'Codex thread has been reset.'
        } else if (utilityKind === 'auth-status') {
          const status = await window.app.codexGetAuthStatus(projectPath)
          popupContent = formatCodexAuthStatus(status)
        } else if (utilityKind === 'plan') {
          get().setSelectedCodexCollaborationMode('plan')
          return
        } else {
          const status = await window.app.codexSetAuth(projectPath, {
            mode: resolvedCodexCommand.mode,
            apiKey: resolvedCodexCommand.apiKey,
          })
          popupContent = `Auth mode updated.\n\n${formatCodexAuthStatus(status)}`
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

  if (effectiveProvider === 'claude') {
    const m = rawContent.match(/^\/(\S+)$/)
    if (m && CLAUDE_INTERCEPTED_COMMANDS[m[1]]) {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      await CLAUDE_INTERCEPTED_COMMANDS[m[1]]()
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

  const userMessageId = `user_${Date.now()}`
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
  const isCompactSlash = (effectiveProvider === 'claude' || effectiveProvider === 'opencode')
    && finalContent.trim() === '/compact'
  set((s) => ({
    ...commitPerSession(s, writeTarget, (sess) => ({
      ...(!isQueuedSend ? { messages: [...sess.messages, userMessage] } : {}),
      ...(isQueuedSend ? { queuedMessages: [...sess.queuedMessages, userMessage] } : {}),
      attachments: [],
      browserAnnotations: [],
      mentions: [],
      miniAppContexts: {},
      userSelections: [],
      codexPlanRejectHintActive: false,
      additionalDirsDirty: false,
      ...(isCompactSlash ? { _pendingCompactUserId: userMessageId } : {}),
      ...((effectiveProvider === 'claude' || effectiveProvider === 'acp') && !isQueuedSend
        ? { awaitingAssistantReply: true }
        : {}),
    })),
    isOpen: true,
  }))

  if (activeContexts.length > 0) {
    const consumedAppIds = activeContexts.map((c) => c.appId)
    window.dispatchEvent(new CustomEvent('miniapp-context-consumed', { detail: { appIds: consumedAppIds } }))
  }

  if (resetLock.current) await resetLock.current

  // Re-read the write session id from the live store when unscoped. A first-turn
  // codex switch above assigns a fresh _activeSessionId via set(), which the
  // snapshot at the top of this function does NOT reflect — using that stale
  // value here silently skipped mini-app tool authorization on the very first
  // codex @-mention. Scoped sends track rotations on writeTarget instead.
  const resolvedSessionId = writeTarget?.sessionId
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

  if (resolvedCodexCommand) {
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

  const liveSession = getScopedPerSession(get(), writeTarget)
  const mergedDirs = mergeProjectAndSessionDirs(project, liveSession)

  try {
    await window.agent.sendMessage(projectPath, {
      content: finalContent,
      model: selectedModel || undefined,
      effort: selectedEffort,
      ...(effectiveProvider === 'opencode' && liveSession.openCodeAgentId
        ? { agent: liveSession.openCodeAgentId }
        : {}),
      images: attachments.length > 0 ? attachments : undefined,
      additionalDirs: mergedDirs.length > 0 ? mergedDirs : undefined,
      clientMessageId: userMessageId,
      sessionId: resolvedSessionId,
      gitBranch: liveSession._gitBranch ?? undefined,
      worktreePath: liveSession._worktreePath ?? undefined,
      userMessageContent: userContent,
      contexts: messageContexts,
      userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
      provider: effectiveProvider,
      ...(liveSession.apiProviderId ? { apiProviderId: liveSession.apiProviderId } : {}),
      ...(isQueuedSend ? { priority: 'next' as const } : {}),
    })
  } catch (err) {
    if (!isQueuedSend) {
      patchSession(() => ({ awaitingAssistantReply: false }))
    }
    throw err
  }
}
