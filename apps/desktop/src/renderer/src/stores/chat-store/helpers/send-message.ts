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
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { CLAUDE_INTERCEPTED_COMMANDS, isRemoteSession } from '../index'
import type { ChatProvider, ChatStore, InputSegment, Mention, SessionWriteTarget } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import {
  nodeHarnessToProviderId,
  nodeStatusToAgentStatus,
  reconcileTranscriptWithLocalMessages,
  type NodeSessionSnapshot,
} from '@/lib/remote-session-messages'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import { expandPathRefTagsForAgent, stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { toastSendFailure } from './send-error-toast'

/**
 * Whether a typed `/name` should be handled by SuperOne instead of the agent.
 * Cursor only owns `/clear` and `/mcp`; other host commands must not steal the turn.
 */
function shouldInterceptHostSlash(provider: ChatProvider, name: string): boolean {
  if (!CLAUDE_INTERCEPTED_COMMANDS[name]) return false
  if (provider === 'cursor') return name === 'clear' || name === 'mcp'
  return true
}

/**
 * Body of useChatStore.sendMessage extracted as a free-standing helper so
 * the store action stays a one-line dispatcher. Drives one full send turn:
 * - worktree activation when a pending base-branch is queued
 * - context/quote/miniapp-reminder suffix assembly
 * - provider resolution (claude vs codex) + codex slash-command parsing
 * - rotate SuperOne session id when first switching an empty draft to codex
 * - utility codex commands (help/reset/auth-status/auth-set/plan) routed to the popup
 * - intercepted slash commands (/provider, /clear, /mcp, Grok /recap)
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
    // SuperOne-local slash intercepts (same as local path) — never forward to node.
    {
      const m = content.trim().match(/^\/(\S+)$/)
      const remoteSess = getScopedPerSession(get(), writeTarget)
      const remoteProvider: ChatProvider = remoteSess.sessionProvider ?? remoteSess.preferredProvider
      if (m && shouldInterceptHostSlash(remoteProvider, m[1]!)) {
        patchSession(() => ({ _pendingSlashCommand: '' }))
        await CLAUDE_INTERCEPTED_COMMANDS[m[1]!]!()
        return
      }
      // Grok manual `/recap` — host RPC only (never a user message / session.send).
      if (m?.[1] === 'recap') {
        const sess = getScopedPerSession(get(), writeTarget)
        if (sess.sessionProvider === 'acp' || sess.preferredProvider === 'acp') {
          if (isGrokAcpAgent(sess.acpAgentId)) {
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
    // Honor UI harness tab (wire ids: claude|codex|acp|opencode). Default claude.
    const uiProvider =
      existingSess.sessionProvider ?? existingSess.preferredProvider ?? 'claude'
    const preferredHarness: 'claude' | 'codex' | 'acp' | 'opencode' =
      uiProvider === 'codex' || uiProvider === 'acp' || uiProvider === 'opencode'
        ? uiProvider
        : 'claude'
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

    // Assemble agent prompt like local (quotes, contexts, annotations, capability tags).
    const writeSess = getScopedPerSession(get(), writeTarget ?? { projectPath, sessionId: sid })
    const annotations = writeSess.browserAnnotations ?? []
    const annotationImages: ImageAttachment[] = annotations
      .filter((a) => a.screenshot)
      .map((a) => ({
        mimeType: 'image/png',
        base64: a.screenshot as string,
        name: `annotation-${a.id}.png`,
      }))
    const userAttachments = explicitAttachments ?? writeSess.attachments
    const attachments: ImageAttachment[] = [...userAttachments, ...annotationImages]
    const annotationSuffix =
      annotations.length > 0
        ? '\n\n' + annotations.map(buildBrowserAnnotationText).join('\n\n')
        : ''
    const mentions: Mention[] = explicitMentions ?? writeSess.mentions
    const rawContent = content.trim()
    if (!rawContent && attachments.length === 0) return

    const activeContexts = Object.values(writeSess.miniAppContexts).filter(
      (slot) => slot.mode === 'inject' || slot.checked,
    )
    const contextSuffix =
      activeContexts.length > 0
        ? '\n\n' +
          activeContexts
            .map(
              (ctx) =>
                `<app-context app="${ctx.appName}" summary="${ctx.summary}">\n${ctx.content}\n</app-context>`,
            )
            .join('\n\n')
        : ''
    const userSelections = writeSess.userSelections
    let quoteSuffix = ''
    if (userSelections.length === 1) {
      quoteSuffix = `\n\n<quote>\n${userSelections[0]}\n</quote>`
    } else if (userSelections.length > 1) {
      const inner = userSelections
        .map((s, i) => `<quote${i + 1}>\n${s}\n</quote${i + 1}>`)
        .join('\n')
      quoteSuffix = `\n\n<quote>\n${inner}\n</quote>`
    }

    // Expand popup-selected path/agent tags to bare @value for the model; keep
    // the stored user bubble as structured tags so only those render as chips.
    let agentContent = expandPathRefTagsForAgent(rawContent)
    let capabilityReminderSuffix = ''
    const capabilityMentions = mentions.filter((m) => isBuiltinCapabilityId(m.kind))
    if (capabilityMentions.length > 0) {
      const {
        CAPABILITY_TAG_REGEX,
        getBuiltinCapability,
        wrapCapabilityMention,
        capabilityToolPrefixClaude,
        capabilityToolPrefixCodex,
        isBuiltinCapabilityId,
      } = await import('@superone/shared/capability-prompt-tags')
      agentContent = agentContent.replace(CAPABILITY_TAG_REGEX, (full, _name, id) => {
        const capId = String(id).trim()
        if (!isBuiltinCapabilityId(capId)) return full
        return wrapCapabilityMention(capId)
      })
      const lines: string[] = [
        'User mentioned built-in capabilities; prefer these MCP tools when relevant:',
      ]
      const seen = new Set<string>()
      for (const m of capabilityMentions) {
        if (seen.has(m.kind)) continue
        seen.add(m.kind)
        const cap = getBuiltinCapability(m.kind)
        if (!cap) continue
        const prefix =
          preferredHarness === 'codex'
            ? capabilityToolPrefixCodex(cap)
            : capabilityToolPrefixClaude(cap)
        lines.push(`- "${cap.displayName}" (${cap.intent}): tools start with "${prefix}"`)
      }
      capabilityReminderSuffix = `\n\n<superone-capability-reminder>\n${lines.join('\n')}\n</superone-capability-reminder>`
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
        const name = app?.manifest?.name ?? m.displayName
        const appId = app?.id ?? m.value
        lines.push(
          `- "${name}" (appId="${appId}"): use mcp__superone__miniapp_call with this appId; call miniapp_list for tool names/schemas`,
        )
      }
      miniAppReminderSuffix = `\n\n<superone-miniapp-reminder>\n${lines.join('\n')}\n</superone-miniapp-reminder>`
      try {
        await window.miniapp?.authorize?.(
          miniAppMentions.map((m) => m.value),
          projectPath,
          sid,
        )
      } catch {
        /* optional on remote */
      }
    }

    let sessionReminderSuffix = ''
    const sessionMentions = mentions.filter((m) => m.kind === 'session' && m.value)
    if (sessionMentions.length > 0) {
      const lines: string[] = [
        'User @-mentioned SuperOne session(s). Use SuperOne sessionId (NOT provider/harness session ids).',
        '',
        'Archive (read-only):',
        '- session_read({ sessionId, view: "meta" | "user" | "assistant" | "text" | "tools" })',
        '- session_search / session_list when you need to locate messages first',
        'Prefer progressive views; do not dump entire transcripts into context.',
        '',
        'Live collaboration with an existing session (requires user approval):',
        '- session_collab_request({ launches: [{ mode: "link", sessionId, summary, task? }] })',
        '- You MUST pass sessionId from the list below; never invent ids.',
        '- After approval: session_collab_start → session_collab_send / session_collab_retrieve.',
        '- Do NOT use mode "spawn" for an already-existing session (spawn creates a new child).',
        '',
        'Mentioned sessions:',
      ]
      const seen = new Set<string>()
      for (const m of sessionMentions) {
        if (!m.value || seen.has(m.value)) continue
        seen.add(m.value)
        lines.push(`- "${m.displayName || m.value}" (sessionId: ${m.value})`)
      }
      sessionReminderSuffix = `\n\n<superone-session-reminder>\n${lines.join('\n')}\n</superone-session-reminder>`
    }

    // Desktop-app @ → Computer Use runs on desktop host via host-action; grant here.
    let desktopAppReminderSuffix = ''
    const desktopAppMentions = mentions.filter((m) => m.kind === 'desktop-app' && m.value)
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
      desktopAppReminderSuffix = `\n\n<superone-desktop-app-reminder>\n${lines.join('\n')}\n</superone-desktop-app-reminder>`
      try {
        if (window.app?.grantComputerUseSessionApps) {
          await window.app.grantComputerUseSessionApps(
            sid,
            desktopAppMentions
              .filter((m) => Boolean(m.value))
              .map((m) => ({
                app: m.displayName || m.value,
                bundleId: m.value,
              })),
          )
        }
      } catch (err) {
        console.error('[sendMessage] remote computer-use session grant failed:', err)
        desktopAppReminderSuffix = ''
      }
    }

    const finalContent =
      agentContent +
      contextSuffix +
      quoteSuffix +
      miniAppReminderSuffix +
      sessionReminderSuffix +
      capabilityReminderSuffix +
      desktopAppReminderSuffix +
      annotationSuffix
    if (!finalContent.trim() && attachments.length === 0) return

    const userMessageId = crypto.randomUUID()
    const attachmentBlock = (att: ImageAttachment): ContentBlock =>
      att.mimeType === 'application/pdf'
        ? { type: 'document' as const, name: att.name, id: att.id }
        : { type: 'image' as const, name: att.name, id: att.id }
    const userContentBlocks: ContentBlock[] = [
      ...attachments.map(attachmentBlock),
      ...(rawContent ? [{ type: 'text' as const, text: rawContent }] : []),
    ]
    const userMsg: ChatMessage = {
      ...createLocalTextUserMessage(userMessageId, rawContent),
      content: userContentBlocks.length > 0 ? userContentBlocks : [{ type: 'text', text: rawContent }],
      providerId: preferredHarness,
      attachments: attachments.length > 0 ? attachments : undefined,
      userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
    }

    const modelForTurn =
      preferredHarness === 'claude' || preferredHarness === 'acp' || preferredHarness === 'opencode'
        ? writeSess.selectedModel || undefined
        : preferredHarness === 'codex'
          ? writeSess.selectedCodexModel || undefined
          : undefined
    const effortForTurn =
      preferredHarness === 'claude' || preferredHarness === 'acp' || preferredHarness === 'opencode'
        ? writeSess.selectedEffort || undefined
        : preferredHarness === 'codex'
          ? writeSess.selectedCodexReasoningEffort || undefined
          : undefined
    const apiProviderIdForTurn = writeSess.apiProviderId ?? null
    const imagesForTurn = attachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      base64: a.base64,
    }))

    // Codex slash commands → session.send turnKind (not desktop-only IPC).
    let remoteTurnKind: 'run' | 'steer' | 'review' | 'compact' | undefined
    let remoteReviewTarget: unknown
    let remoteText = finalContent
    let remoteCollaborationMode: string | undefined
    if (preferredHarness === 'codex') {
      const cmd = parseCodexCommand(rawContent)
      if (cmd?.kind === 'compact') {
        remoteTurnKind = 'compact'
      } else if (cmd?.kind === 'review') {
        remoteTurnKind = 'review'
        remoteReviewTarget = cmd.target
      } else if (writeSess.status === 'streaming') {
        // Desktop: concurrent send while streaming steers the active turn.
        remoteTurnKind = 'steer'
      } else {
        remoteTurnKind = 'run'
      }
      remoteCollaborationMode = writeSess.selectedCodexCollaborationMode || undefined
    }

    // Always append to messages; node queues concurrent sends (priority=next parity).
    patchSession((sess) => ({
      messages: [...sess.messages, userMsg],
      awaitingAssistantReply: true,
      status: 'streaming',
      attachments: [],
      mentions: [],
      userSelections: [],
      browserAnnotations: [],
      miniAppContexts: {},
      draftId: null,
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

    const permissionModeForTurn = writeSess.permissionMode || undefined
    const projectState = getProject(get(), projectPath)
    const liveSession = getScopedPerSession(get(), writeTarget ?? { projectPath, sessionId: sid })
    const additionalDirs = mergeProjectAndSessionDirs(projectState, liveSession)
    // Desktop disabled-skills filter → Claude SDK skills allow-list (node discovers rest).
    const storeDisabled = get().disabledSkills ?? []
    const disabledSkillsForTurn =
      preferredHarness === 'claude' && storeDisabled.length > 0 ? storeDisabled : undefined
    let enabledSkillsForTurn: string[] | undefined
    if (disabledSkillsForTurn) {
      const known = [
        ...projectState.slashCommands,
        ...projectState._projectSkills,
      ]
        .filter((c) => c.isSkill)
        .map((c) => c.name)
      if (known.length > 0) {
        const disabled = new Set(disabledSkillsForTurn)
        enabledSkillsForTurn = known.filter((n) => !disabled.has(n))
      }
    }

    try {
      // Node accepts send while streaming (FIFO queue / codex steer). Drain stays
      // open across queued turns until the session is fully idle.
      // turnKind / collaborationMode / reviewTarget are forwarded to node session.send
      // (preload types lag; cast keeps remote codex on the session path, not desktop IPC).
      const sendInput = {
        sessionId: sid,
        text: remoteText,
        clientMessageId: userMessageId,
        projectPath,
        providerId: preferredHarness,
        cwdHostPath,
        ...(modelForTurn ? { model: modelForTurn } : {}),
        ...(effortForTurn ? { effort: effortForTurn } : {}),
        ...(permissionModeForTurn ? { permissionMode: permissionModeForTurn } : {}),
        ...(additionalDirs.length > 0 ? { additionalDirectories: additionalDirs } : {}),
        ...(enabledSkillsForTurn && enabledSkillsForTurn.length > 0
          ? { enabledSkills: enabledSkillsForTurn }
          : {}),
        ...(disabledSkillsForTurn ? { disabledSkills: disabledSkillsForTurn } : {}),
        ...(imagesForTurn.length > 0 ? { images: imagesForTurn } : {}),
        ...(apiProviderIdForTurn ? { apiProviderId: apiProviderIdForTurn } : {}),
        ...(remoteTurnKind ? { turnKind: remoteTurnKind } : {}),
        ...(remoteCollaborationMode ? { collaborationMode: remoteCollaborationMode } : {}),
        ...(remoteReviewTarget !== undefined ? { reviewTarget: remoteReviewTarget } : {}),
      }
      const finalSnap = (await window.environment.sendSessionMessage(
        remoteKey.connectionId,
        sendInput as Parameters<typeof window.environment.sendSessionMessage>[1],
      )) as NodeSessionSnapshot | null
      const providerId = nodeHarnessToProviderId(
        finalSnap?.harnessId || finalSnap?.providerId || preferredHarness,
      )
      const { nodePendingInteractionFields } = await import('@/lib/remote-session-messages')
      const pendingFields = nodePendingInteractionFields(finalSnap?.pendingInteraction)
      const stillLive =
        pendingFields.awaitingAssistantReply || finalSnap?.status === 'streaming'
      const snapTitle =
        typeof finalSnap?.title === 'string' && finalSnap.title.trim()
          ? finalSnap.title.trim()
          : null
      // Prefer node snap title; otherwise user-visible plain text (not agent tag markup).
      const titleSource = stripMiniAppMarkup(rawContent || finalContent).trim().replace(/\s+/g, ' ')
      const derivedTitle =
        snapTitle ||
        (titleSource
          ? titleSource.length > 100
            ? `${titleSource.slice(0, 100)}…`
            : titleSource
          : null)
      patchSession((sess) => ({
        messages: reconcileTranscriptWithLocalMessages(
          sess.messages,
          finalSnap?.transcript,
          providerId,
        ),
        awaitingAssistantReply: stillLive,
        status: stillLive ? 'streaming' : nodeStatusToAgentStatus(finalSnap?.status),
        pendingPermissions: pendingFields.pendingPermissions,
        pendingQuestion: pendingFields.pendingQuestion,
        pendingPlanApproval: pendingFields.pendingPlanApproval,
        ...(derivedTitle ? { _title: derivedTitle } : {}),
      }))
      // Keep sidebar history in sync: title + harness session id for Copy Session ID.
      const bareProviderSessionId =
        (typeof finalSnap?.providerSessionId === 'string' && finalSnap.providerSessionId.trim()
          ? finalSnap.providerSessionId.trim()
          : null) ?? providerSessionIdFromResume(finalSnap?.providerResume)
      if (derivedTitle || bareProviderSessionId) {
        set((s) => {
          const project = s.projectSessions[projectPath]
          let sessions = project?.sessions
          let sessionsChanged = false
          if (project && Array.isArray(sessions)) {
            sessions = sessions.map((entry) => {
              if (entry.sessionId !== sid) return entry
              const nextTitle = derivedTitle && entry.title !== derivedTitle ? derivedTitle : entry.title
              const nextProviderSessionId =
                bareProviderSessionId && entry.providerSessionId !== bareProviderSessionId
                  ? bareProviderSessionId
                  : entry.providerSessionId
              if (
                nextTitle === entry.title &&
                nextProviderSessionId === entry.providerSessionId
              ) {
                return entry
              }
              sessionsChanged = true
              return {
                ...entry,
                title: nextTitle,
                ...(nextProviderSessionId ? { providerSessionId: nextProviderSessionId } : {}),
              }
            })
          }
          return {
            ...(derivedTitle ? { agentTitles: { ...s.agentTitles, [sid]: derivedTitle } } : {}),
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
      // ChatInput fire-and-forgets sendMessage; without a toast the bubble appears
      // and nothing else happens (silent unhandled rejection).
      toastSendFailure(err)
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
    preferredProvider === 'codex'
    || preferredProvider === 'acp'
    || preferredProvider === 'opencode'
    || preferredProvider === 'cursor'
      ? preferredProvider
      : 'claude'
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
    sessionReminderSuffix +
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
      if (writeTarget && previousSid) {
        writeTarget = { projectPath, sessionId: nextSid }
        void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
          useMosaicStore.getState().replaceTileSession(projectPath, previousSid, nextSid)
        }).catch(() => {})
      } else if (writeTarget) {
        writeTarget = { projectPath, sessionId: nextSid }
      }
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

  if (effectiveProvider === 'claude' || effectiveProvider === 'cursor') {
    const m = rawContent.match(/^\/(\S+)$/)
    if (m && shouldInterceptHostSlash(effectiveProvider, m[1]!)) {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      await CLAUDE_INTERCEPTED_COMMANDS[m[1]!]!()
      return
    }
  }

  // Host-only `/workflows` for Grok/ACP (same popup as Claude; never a prompt turn).
  if (effectiveProvider === 'acp' && /^\/workflows$/.test(rawContent)) {
    patchSession(() => ({ _pendingSlashCommand: '' }))
    await CLAUDE_INTERCEPTED_COMMANDS.workflows!()
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
      draftId: null,
      ...(isCompactSlash ? { _pendingCompactUserId: userMessageId } : {}),
      ...((effectiveProvider === 'claude' || effectiveProvider === 'acp'
        || effectiveProvider === 'cursor' || effectiveProvider === 'opencode') && !isQueuedSend
        ? { awaitingAssistantReply: true }
        : {}),
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
      ...(effectiveProvider === 'cursor'
        ? { cursor: { params: liveSession.cursorModelParams ?? {} } }
        : {}),
      ...(isQueuedSend ? { priority: 'next' as const } : {}),
    })
  } catch (err) {
    if (!isQueuedSend) {
      patchSession(() => ({ awaitingAssistantReply: false }))
    }
    toastSendFailure(err)
    throw err
  }
}
