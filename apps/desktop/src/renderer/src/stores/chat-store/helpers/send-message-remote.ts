import type { ChatMessage, ContentBlock, ImageAttachment } from '@superone/shared/agent-types'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
import { buildBrowserAnnotationText } from './browser-annotation'
import { createDefaultPerSessionState } from '../defaults'
import { createLocalTextUserMessage, parseCodexCommand, resolveSessionCodexSelection } from './codex-helpers'
import type { ChatStoreSet } from './lifecycle'
import { getProject, getScopedPerSession, mergeCallerScopedDirs } from './store-helpers'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { CLAUDE_INTERCEPTED_COMMANDS } from '../index'
import type { ChatProvider, ChatStore, InputSegment, Mention } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { nodeHarnessToProviderId, nodeStatusToAgentStatus, reconcileTranscriptWithLocalMessages, type NodeSessionSnapshot } from '@/lib/remote-session-messages'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import { expandPathRefTagsForAgent, stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { deliverUserSend } from './send-replay'
import { isRemoteSendDetached } from '@superone/shared/send-failure'
import { shouldInterceptHostSlash } from './send-command-policy'
import type { SendWriteScope } from './send-write-scope'

/** Remote-node sends keep lease/drain behavior separate from the desktop dispatch. */
export async function sendRemoteMessageImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  remoteKey: NonNullable<ReturnType<typeof parseRemoteProjectKey>>,
  content: string,
  writeScope: SendWriteScope,
  segments?: InputSegment[],
  explicitMentions?: Mention[],
  explicitAttachments?: ImageAttachment[],
): Promise<void> {
  const resolveWriteSid = writeScope.sessionId
  const patchSession = writeScope.patch
  // SuperOne-local slash intercepts (same as local path) — never forward to node.
  {
    const m = content.trim().match(/^\/(\S+)$/)
    const remoteSess = getScopedPerSession(get(), writeScope.target)
    const remoteProvider: ChatProvider = remoteSess.sessionProvider ?? remoteSess.preferredProvider
    if (m && shouldInterceptHostSlash(remoteProvider, m[1]!)) {
      patchSession(() => ({ _pendingSlashCommand: '' }))
      await CLAUDE_INTERCEPTED_COMMANDS[m[1]!]!()
      return
    }
    // Grok manual `/recap` — host RPC only (never a user message / session.send).
    if (m?.[1] === 'recap') {
      const sess = getScopedPerSession(get(), writeScope.target)
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
    ? getScopedPerSession(get(), writeScope.target ?? { projectPath, sessionId: candidateSid })
    : getScopedPerSession(get(), writeScope.target)
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
    writeScope.target = { projectPath, sessionId: sid }
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
    writeScope.target = { projectPath, sessionId: sid }
  }

  // Assemble agent prompt like local (quotes, contexts, annotations, capability tags).
  const writeSess = getScopedPerSession(get(), writeScope.target ?? { projectPath, sessionId: sid })
  const codexSelectionForTurn = preferredHarness === 'codex'
    ? resolveSessionCodexSelection(
        getProject(get(), projectPath).codexModels,
        writeSess.selectedCodexModel,
        writeSess.selectedCodexReasoningEffort,
      )
    : undefined
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
      formatCapabilityReminderLine,
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
      lines.push(formatCapabilityReminderLine(cap, preferredHarness === 'codex' ? 'codex' : 'claude'))
    }
    capabilityReminderSuffix = `\n\n<superone-capability-reminder>\n${lines.join('\n')}\n</superone-capability-reminder>`
  }

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
      '- Do NOT use mode "spawn" or "handoff" for an already-existing session (both create a new session).',
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
    agentReminderSuffix +
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
        ? codexSelectionForTurn?.modelId || undefined
        : undefined
  const effortForTurn =
    preferredHarness === 'claude' || preferredHarness === 'acp' || preferredHarness === 'opencode'
      ? writeSess.selectedEffort || undefined
      : preferredHarness === 'codex'
        ? codexSelectionForTurn?.reasoningEffort
        : undefined
  const apiProviderIdForTurn = writeSess.apiProviderId ?? null
  const imagesForTurn = attachments.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    base64: a.base64,
    ...(a.originalPath ? { originalPath: a.originalPath } : {}),
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
  const liveSession = getScopedPerSession(get(), writeScope.target ?? { projectPath, sessionId: sid })
  const additionalDirs = mergeCallerScopedDirs(projectState, liveSession)
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
  const statusBeforeSend = writeSess.status
  const applyFinalSnapshot = async (finalSnap: NodeSessionSnapshot | null) => {
    const providerId = nodeHarnessToProviderId(
      finalSnap?.harnessId || finalSnap?.providerId || preferredHarness,
    )
    const { nodePendingInteractionFields } = await import('@/lib/remote-session-messages')
    const pendingFields = nodePendingInteractionFields(finalSnap?.pendingInteraction, finalSnap?.pendingInputRequests)
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
        ? titleSource.length > SESSION_TITLE_MAX_CHARS
          ? `${titleSource.slice(0, SESSION_TITLE_MAX_CHARS)}…`
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
  }
  await deliverUserSend({
    messageId: userMessageId,
    patchSession,
    deliver: () => window.environment.sendSessionMessage(
      remoteKey.connectionId,
      sendInput as Parameters<typeof window.environment.sendSessionMessage>[1],
    ),
    onDelivered: async (result) => {
      // The node holds the message and only the stream dropped: reconnect
      // recovery picks the turn back up, so this is not a send failure.
      if (isRemoteSendDetached(result)) return
      await applyFinalSnapshot(result as NodeSessionSnapshot | null)
    },
    retryState: () => ({ awaitingAssistantReply: true, status: 'streaming' }),
    // A concurrent turn this send was queued behind is still running.
    failureState: () => ({ status: statusBeforeSend === 'streaming' ? 'streaming' : 'idle' }),
  })
  return
}
