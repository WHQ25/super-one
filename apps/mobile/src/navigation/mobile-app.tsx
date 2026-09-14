import { PersistedWorkspace } from '../persisted-workspace'
import { networkLedger } from '../network-ledger'
import type { RemoteSystemInfo } from '@superone/shared/agent-types'
import { invalidateGitResources, requestGitResource } from '../git-resource-cache'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'
import { refreshSessionCatalog } from '../session-catalog-refresh'
import { useComposerSend } from './use-composer-send'
import { useTranscriptSync } from './use-transcript-sync'
import { SessionActivityContext, useWorkspaceActivity } from './use-session-activity'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { BackHandler, Linking, Pressable, useWindowDimensions, View } from 'react-native'
import { StatusBanner } from '../ui/status-banner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { HostOutbound } from '@superone/chat-view'
import {
  checkRelayDesktopOnline, loadPairings, parsePairQr, RelayClient, savePairings, startPairingHandshake,
  upsertPairing, type SavedPairing,
} from '@superone/relay-client'
import type {
  AskUserQuestionRequest, ChatMessage, GitDirtyStatus, HarnessId, ImageAttachment, PermissionRequest,
  ListHarnessOptionsResponse, PlanApprovalRequest, RemoteCommand, RemoteHarnessOption,
  SandboxInfo, SandboxMode, SessionAgentLaunchProposal, TodoItem, WorktreeInfo,
} from '@superone/shared/agent-types'
import { resolveRingContextWindow, SESSION_AGENT_LAUNCHES_FIELD } from '@superone/shared/agent-types'
import { selectedCatalogContextWindow } from '@superone/shared/model-option-params'
import { ChatRuntime, type SessionWorktreeFacts } from '../runtime'
import { openedSessionSelection } from '../session-restore-selection'
import { TerminalRuntime, type TerminalUi } from '../terminal-runtime'
import { randomId } from '../ids'
import { newMessageId } from '@superone/shared/message-id'
import { canSteerQueued, canSteerQueuedSoon, composerQueuedSendFields, queuedMessageText } from '../queued-send'
import { mentionInsertText } from '../mentions'
import { SlashOutputPanel } from '../ui/slash-output-panel'
import { McpPanel } from '../ui/mcp-panel'
import { AddDirScreen } from '../screens/add-dir-screen'
import { CollabRequestScreen } from '../screens/collab-request-screen'
import { CollabTaskScreen } from '../screens/collab-task-screen'
import { WorkflowsPanel } from '../ui/workflows-panel'
import { workflowRunRows } from '../workflow-runs'
import { requestMcpServers, type McpServerRow } from '../mcp-status'
import { mentionTokenFromItem } from '../mention-selection'
import { isPairingQrInput, normalizePairingInput } from '../pairing-input'
import { usePairingDeepLink } from '../pairing-deep-link'
import { shouldSubmitFromKeyboard } from '../composer-state'
import { replaceFirstLine } from '../composer-first-line'
import { CHAT_VIEW_STATE_KEY, parseStoredChatViewStates, restoredChatWindow, type ChatViewState } from '../chat-view-state'
import { composerDraftKey, SessionComposerDrafts } from '../composer-session-drafts'
import { useComposerDraft } from './use-composer-draft'
import { useMobileDraftSession } from './use-mobile-draft-session'
import { EMPTY_COMPOSER_DRAFT } from '../composer-draft-state'
import { useComposerSuggestions } from './use-composer-suggestions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { harnessSupportsAdditionalDirs } from '../provider-state'
import { isManualRecapCommand, shouldInterceptGrokRecap } from '../recap-command'
import { useAutoRecap } from './use-auto-recap'
import { harnessSupportsSandbox, sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import { suggestionHarnessKey } from '@superone/shared/suggestion-harness-order'
import { fileBrowserHome, joinRemotePath, parentRemotePath, resolveRemoteFilePath, type FileBrowserMode } from '../shell-state'
import { getMobileDeviceName } from '../mobile-device-name'
import { loadOrCreateMobileId, mobileKv } from '../storage'
import { registerFatalChatViewError } from '../chat-view-recovery'
import { pickAndUploadProjectFile, pickChatImages, pickChatPdf, showAttachmentMenu } from '../attachments'
import { ConnectedAppSettingsScreen } from '../screens/app-settings-screen'
import type { ShellGitInfo } from '../project-types'
import { describeSessionGit } from '../session-git-status'
import {
  buildWorktreeCreateOptions,
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from '../worktree-state'
import { shouldUseTabletMultiPane } from '../layout-state'
import { WorkspaceSidebar } from './workspace-sidebar'
import { sessionListInvalidations, type SessionListRow as SessionRow } from '../session-list-state'
import { WorkspaceListCache } from '../workspace-list-cache'
import { injectHostMessage as inject, resolveNativeRequest } from '../native-actions'
import { createMediaPorts } from '../media-ports'
import type { ReconnectController } from '../reconnect-controller'
import { createMobileRelayConnection } from '../mobile-relay-connection'
import { SessionTransition } from '../session-transition'
import { readProjectSessions } from './workspace-data'
import { useRemoteDirectory } from './use-remote-directory'
import { useProjectGitStatus } from './use-project-git-status'
import { useProjectGitInfo } from './use-project-git-info'
import { useComposerUsage } from './use-harness-usage'
import type { LiveRateLimit } from '../harness-usage'
import { useFileSearch } from './use-file-search'
import { completeTypedPath, usePathAutocomplete } from './use-path-autocomplete'
import { useAdditionalDirs } from './use-additional-dirs'
import { collabRequestOf, useCollabRequest } from './use-collab-request'
import { useFilePreview } from './use-file-preview'
import { usePromptCollapse } from './use-prompt-collapse'
import { collapsedPendingPrompts } from '../pending-prompt-state'
import { clearFilePreviewCache } from '../file-preview-cache-store'
import { sessionTranscriptCache } from '../session-transcript-cache'
import { loadInlineImage } from '../inline-images'
import { loadTextFile } from '../text-files'
import { loadVideoPoster } from '../video-posters'
import { requestLinkFavicon } from '../link-favicons'
import { NewFolderSheet } from '../prompts/NewFolderSheet'
import { FileFinderView } from '../screens/file-finder-view'
import { leaveMobileSession, sessionRemovalStatus } from '../session-exit'
import type { Project } from '../project-types'
import { BranchScreen } from '../screens/branch-screen'
import { ProjectPickerScreen } from '../screens/project-picker-screen'
import { SessionSearchScreen } from '../screens/session-search-screen'
import { AddProjectScreen } from '../screens/add-project-screen'
import { WorktreeScreen } from '../screens/worktree-screen'
import { runUiAction } from '../ui-action'
import { FilesScreen } from '../screens/files-screen'
import { ChatScreen } from '../screens/chat-screen'
import { PairingsScreen } from '../screens/pairings-screen'
import { ConnectedTerminal } from './connected-terminal'
import { MobileNavigator, type AddProjectOrigin, type FilesOrigin, type MobileRoute as Screen } from './mobile-navigator'
import { MobileHeader, mobileHeaderTitle } from './mobile-header'
import { useAddProject } from './use-add-project'
import { MobileOverlays } from './mobile-overlays'
import { MobileKeyboardFrame } from './mobile-keyboard-frame'
import { useHarnessSelection } from './use-harness-selection'
import { fetchShellDetails } from './shell-details'
import { subscribeHarnessResources, bindHarnessPersistence, markHarnessResourcesStale, peekHarnessResource, preloadHarnessResources, requestHarnessResource } from '../harness-resource-cache'
import { useReconnectOnForeground } from '../use-reconnect-on-foreground'
import { useDeviceDiscovery } from './use-device-discovery'
import { isFullBleedScreen } from '../layout-state'
import { isReachable, type ReconnectInfo } from '../device-status'
import { logRelayEventTypes } from '../relay-debug'
import { dynamicMentionArtworkRevision, dynamicMentionArtworkSnapshot } from '../ui/mention-dynamic-artwork'
import { loadMcpIcons, mcpIconsRevision, mcpIconsSnapshot } from '../mcp-icons'
import { useMobileLocale } from '../i18n/context'
import { useOrientationLock } from './use-orientation-lock'
const kv = mobileKv
export function MobileApp() {
  const styles = useMobileStyles()
  const { tokens, setHarness } = useMobileTheme()
  const { locale, t } = useMobileLocale()
  const webViewTheme = useMemo(() => mobileWebViewTheme(tokens), [tokens])
  const { width, height, fontScale } = useWindowDimensions()
  const [screen, setScreen] = useState<Screen>('pair')
  const [paste, setPaste] = useState('')
  const [lan, setLan] = useState('')
  const [status, setStatus] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [pairings, setPairings] = useState<SavedPairing[]>([])
  const [activePairingId, setActivePairingId] = useState<string | null>(null)
  const activePairingIdRef = useRef(activePairingId)
  activePairingIdRef.current = activePairingId
  const [connectingPairingId, setConnectingPairingId] = useState<string | null>(null)
  const [activeTransport, setActiveTransport] = useState<'lan' | 'relay' | null>(null)
  const [reconnect, setReconnect] = useState<ReconnectInfo | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState('')
  const harnessSelection = useHarnessSelection()
  const {
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    selectedEffort,
    setSelectedEffort,
    selectedAcpAgentId,
    models,
    efforts,
    permissionMode: permMode,
    setPermissionMode: setPermMode,
    permissionModes: permModes,
    applySystemInfo,
  } = harnessSelection
  // Empty until the host answers; the switcher hides itself below two rows.
  const [harnessOptions, setHarnessOptions] = useState<RemoteHarnessOption[]>([])
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [worktreeDirty, setWorktreeDirty] = useState<Record<string, GitDirtyStatus>>({})
  const [branches, setBranches] = useState<string[]>([])
  const [checkedOutBranches, setCheckedOutBranches] = useState<string[]>([])
  const [worktreeSelection, setWorktreeSelection] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  // The worktree page edits a draft so that going back discards it; only the
  // header's confirm writes it through.
  const [worktreeDraft, setWorktreeDraft] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([])
  const composerDraft = useComposerDraft()
  const { draft, draftRef, lastDraftChangeAtRef } = composerDraft
  const sessionDrafts = useRef(new SessionComposerDrafts()).current
  const [terminalUi, setTerminalUi] = useState<TerminalUi>({ writable: false, title: 'Terminal', tabs: [], activeId: '' })
  const [streaming, setStreaming] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'offline'>('offline')
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  /**
   * Bumped whenever the host reports a session-list change, and once after a
   * reconnect — events that landed while the socket was down were never
   * delivered, so everything cached is suspect. It is only a tick: which lists
   * went stale is recorded per project in `workspaceCache`, so a change in one
   * project never costs another a request.
   */
  const [sessionListRevision, setSessionListRevision] = useState(0)
  /**
   * Session lists read over the current connection. Outlives the drawer, which
   * unmounts on every close, so opening it paints from here and re-reads only
   * what the host has invalidated since. Replaced with the client: another
   * desktop's lists are another desktop's.
   */
  const [workspaceCache, setWorkspaceCache] = useState(() => new WorkspaceListCache())
  // The same object, readable from async flows that started before a re-render.
  const workspaceCacheRef = useRef(workspaceCache)
  /** Where a session goes when it ends, fails or is removed: the workspace, open. */
  const returnToWorkspace = () => { setScreen('chat'); setSessionSwitcherOpen(true) }
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([])
  const [todos, setTodos] = useState<Record<string, TodoItem>>({})
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([])
  const [slashOutput, setSlashOutput] = useState<{ command: string; content: string } | null>(null)
  const [mcp, setMcp] = useState<{ open: boolean; loading: boolean; rows: McpServerRow[]; error?: string }>(
    { open: false, loading: false, rows: [] },
  )
  const [workflowsOpen, setWorkflowsOpen] = useState(false)
  const [sandboxInfo, setSandboxInfo] = useState<SandboxInfo | null>(null)
  /**
   * A sandbox picked before the session exists. There is no runtime to push it
   * to yet, so it is held here, drives the chip, and rides `create_session` —
   * without it the tap on the landing screen resolved to nothing at all.
   */
  const [pendingSandboxMode, setPendingSandboxMode] = useState<SandboxMode | null>(null)
  const [sessionWorktree, setSessionWorktree] = useState<SessionWorktreeFacts & { removed: boolean }>(
    { isWorktree: false, worktreePath: null, gitBranch: null, removed: false },
  )
  const [usage, setUsage] = useState({ contextTokens: 0, contextWindow: null as number | null, totalCostUsd: 0 })
  // The live `rate_limit` event, already reduced by chat-core; the meter chip
  // tints on it before the next polled reading confirms the limit.
  const [rateLimit, setRateLimit] = useState<LiveRateLimit | null>(null)
  // A live session reports its own sandbox; before one exists the chip answers
  // from the pick made here, falling back to the default the host would apply.
  const composerSandboxInfo = sessionId
    ? sandboxInfo
    : sandboxInfoFromMode(pendingSandboxMode ?? harnessSelection.defaultSandboxMode ?? 'off')
  // The phone has no models.dev catalog, so the window comes from the harness's own
  // model row, whatever a usage event reported, and Claude's built-in fallback.
  // Cursor's picked `context` param (300k / 1m) wins; the model row carries the default.
  const cursorContextParam = harnessSelection.modelParams.context
  const ringContextWindow = useMemo(() => {
    const model = models.find((entry) => entry.id === selectedModel)
    return resolveRingContextWindow({
      harnessId: selectedProvider,
      modelId: selectedModel,
      resolvedModel: model?.resolvedModel,
      harnessContextWindow: model?.contextWindow,
      sessionContextWindow: usage.contextWindow,
      claudeFallback: selectedProvider === 'claude',
      selectedContextWindow: selectedProvider === 'cursor'
        ? selectedCatalogContextWindow(cursorContextParam, model)
        : null,
    })
  }, [models, selectedModel, selectedProvider, usage.contextWindow, cursorContextParam])
  const [perm, setPerm] = useState<PermissionRequest | null>(null)
  const [plan, setPlan] = useState<PlanApprovalRequest | null>(null)
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null)
  const mediaPorts = useMemo(() => createMediaPorts(), [])
  const webRef = useRef<WebView>(null)
  const termRef = useRef<WebView>(null)
  const clientRef = useRef<RelayClient | null>(null)
  const autoRecap = useAutoRecap({
    clientRef,
    sessionId,
    projectPath: project?.path ?? null,
    eligible: shouldInterceptGrokRecap(selectedProvider, selectedAcpAgentId) && hasTranscript,
  })
  const filePreview = useFilePreview({ clientRef, transport: activeTransport, project, sessionId, pairingId: activePairingId })
  const promptCollapse = usePromptCollapse()
  useOrientationLock({ filePreviewOpen: filePreview.state != null })
  const workspaceActivity = useWorkspaceActivity(clientRef.current, connectionState === 'connected', screen === 'chat' && !sessionSwitcherOpen ? sessionId : null)
  const directory = useRemoteDirectory(clientRef)
  const { load: loadDirectory, path: directoryPath, items: directoryItems } = directory
  // The browser is a project tree by default; computer mode is the folder-picking
  // shape, unfenced and named after the machine.
  const [browserKind, setBrowserKind] = useState<'project' | 'computer'>('project')
  // One overlay, two questions: search a project by filename, or type a path on the
  // machine. `gotoPath` is the field's own draft — it is not where the browser is.
  const [finderOpen, setFinderOpen] = useState(false)
  const [gotoPath, setGotoPath] = useState('')
  const [folderPrompt, setFolderPrompt] = useState<{ value: string; error?: string } | null>(null)
  const gitStatus = useProjectGitStatus(clientRef)
  const { gitInfo, refresh: refreshGitInfo, replace: replaceGitInfo } = useProjectGitInfo({
    clientRef,
    projectPath: project?.path,
    sessionId,
    streaming,
  })
  const composerUsage = useComposerUsage({
    clientRef, projectPath: project?.path, provider: selectedProvider, sessionId,
    apiProviderId: harnessSelection.selectedProviderId, acpAgentId: selectedAcpAgentId, streaming, rateLimit,
  })
  const additionalDirs = useAdditionalDirs({
    clientRef, projectPath: project?.path, provider: selectedProvider, sessionId,
    projectDirs: workspaceDirs, onDirs: setWorkspaceDirs,
  })
  // The relay's event callback is built once per connection, so it cannot close
  // over this render's hook — the same reason `runtimeRef` exists.
  const additionalDirsRef = useRef(additionalDirs)
  additionalDirsRef.current = additionalDirs
  const runtimeRef = useRef<ChatRuntime | null>(null)
  const termRuntimeRef = useRef<TerminalRuntime | null>(null)
  // The launch whose brief is open on the `collab-task` page; the brief itself is
  // fetched there, because the request only carries summaries over the wire.
  const [collabTask, setCollabTask] = useState<SessionAgentLaunchProposal | null>(null)
  // A collaboration request is a page, not a sheet; walking away from it rejects.
  const collab = useCollabRequest({
    request: collabRequestOf(perm),
    screen,
    setScreen,
    reject: (requestId, feedback) => runUiAction(
      () => runtimeRef.current?.respondPermission(requestId, false, undefined, undefined, feedback),
      setStatus,
      'permission response failed',
    ),
  })
  const reconnectControllerRef = useRef<ReconnectController | null>(null)
  const connectionRef = useRef<{ state: 'connected' | 'reconnecting' | 'offline'; epoch: number }>({ state: 'connected', epoch: 0 })
  const sessionTransitionRef = useRef(new SessionTransition())
  const chatViewStatesRef = useRef<Record<string, ChatViewState>>({})
  const viewStateWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fatalReloadRef = useRef({ startedAt: 0, count: 0 })
  const mentionArtworkRevisionRef = useRef(-1)
  const mcpIconsRevisionRef = useRef(-1)
  const suggestions = useComposerSuggestions(runtimeRef, `${activePairingId}:${project?.path}:${sessionId}:${selectedProvider}:${selectedAcpAgentId ?? ''}`, { client: clientRef, projectPath: project?.path, provider: selectedProvider, acpAgentId: selectedAcpAgentId, projects, iconStore: mobileKv })
  const { slashHits, mentionRows } = suggestions
  const remoteDrafts = useMobileDraftSession({
    kv, pairingId: activePairingId, clientRef, composer: composerDraft, attachments, sessionId,
    project, projects, selection: harnessSelection, worktree: worktreeSelection, sandbox: composerSandboxInfo,
    sessionDirs: additionalDirs.sessionDirs, restoreSessionDirs: additionalDirs.restoreSessionDirs,
    setWorktree: setWorktreeSelection, setSandbox: setPendingSandboxMode, setAttachments, setHarness,
    applyText: suggestions.applyProgrammatic,
    openProject: (target) => openProject(target),
    loadSettings: (provider, target) => loadShellDetails(provider, target),
    leaveSession: () => leaveActiveSession(),
    showDraft: (title) => { setActiveSessionTitle(title); setScreen('chat') },
    showWorkspace: returnToWorkspace, onError: setStatus,
  })
  const remoteDraftsRef = useRef(remoteDrafts)
  remoteDraftsRef.current = remoteDrafts
  /**
   * Model/effort picks are visit-local until send. Composer text is the
   * opposite: park it per session so switching away does not leak it, and
   * switching back restores what was typed there.
   */
  const switchComposerDraft = (nextSessionId: string | null, nextProjectPath = project?.path) => {
    const from = composerDraftKey(activePairingId, project?.path, sessionId)
    const to = composerDraftKey(activePairingId, nextProjectPath, nextSessionId)
    if (from === to) return
    if (sessionId) sessionDrafts.stash(from, { ...composerDraft.exportSnapshot(), attachments: attachmentsRef.current })
    const restored = nextSessionId ? sessionDrafts.load(to) : { ...EMPTY_COMPOSER_DRAFT, attachments: [] }
    composerDraft.replaceWith(restored)
    suggestions.applyProgrammatic(restored.text)
    setAttachments(restored.attachments)
  }
  const composerSwitchRef = useRef(switchComposerDraft)
  composerSwitchRef.current = switchComposerDraft
  const systemInfoRequestRef = useRef(0)
  const shellDetailsRequestRef = useRef(0)
  // Files hangs off Project settings or off the session menu; back has to unwind
  // to whichever one actually opened it.
  const [filesOrigin, setFilesOrigin] = useState<FilesOrigin>('settings')
  const [addProjectOrigin, setAddProjectOrigin] = useState<AddProjectOrigin>('workspace')
  const suppressReconnectRef = useRef(false)
  const scanningRef = useRef(false)
  const pairingSocketRef = useRef<WebSocket | null>(null)
  const pairingCancelledRef = useRef(false)
  useReconnectOnForeground(() => {
    networkLedger.mark('foreground')
    const client = clientRef.current
    if (!client || connectionRef.current.state !== 'connected') {
      reconnectControllerRef.current?.force(connectionRef.current.epoch)
      return
    }
    markHarnessResourcesStale(client)
    void client.probeConnection().then(healthy => {
      if (!healthy && clientRef.current === client) reconnectControllerRef.current?.force(connectionRef.current.epoch)
    })
  })
  const discovery = useDeviceDiscovery({
    pairings,
    activePairingId,
    activeTransport,
    connectionState,
    connectingPairingId,
  })
  useEffect(() => {
    void loadPairings(kv).then(setPairings).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'failed to load pairings')
    })
    void loadOrCreateMobileId().then(setDeviceId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'failed to initialize device')
    })
    void kv.get(CHAT_VIEW_STATE_KEY).then((raw) => {
      if (!raw) return
      chatViewStatesRef.current = parseStoredChatViewStates(raw)
    })
    return () => {
      ++connectGenerationRef.current
      workspaceCacheRef.current.persistence?.dispose()
      if (viewStateWriteTimerRef.current != null) clearTimeout(viewStateWriteTimerRef.current)
      suppressReconnectRef.current = true
      reconnectControllerRef.current?.cancel()
      clientRef.current?.disconnect()
      runtimeRef.current?.dispose()
    }
  }, [])
  useEffect(() => {
    inject(webRef, webViewTheme)
    inject(termRef, webViewTheme)
  }, [webViewTheme])
  useEffect(() => {
    inject(webRef, { type: 'setViewport', fontScale, locale })
  }, [fontScale, locale])
  const transcriptSync = useTranscriptSync(webRef)
  const syncSheets = (runtime: ChatRuntime, hydrate = false) => {
    if (connectionRef.current.epoch !== runtime.epoch) {
      connectionRef.current = { state: 'connected', epoch: runtime.epoch }
      setConnectionState('connected')
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
    }
    const pending = runtime.session.pendingPermissions[0]
    const mentionArtworkRevision = dynamicMentionArtworkRevision()
    const includeMentionArtwork = hydrate || mentionArtworkRevision !== mentionArtworkRevisionRef.current
    const mentionArtwork = includeMentionArtwork ? dynamicMentionArtworkSnapshot() : undefined
    const iconsRevision = mcpIconsRevision()
    const includeMcpIcons = hydrate || iconsRevision !== mcpIconsRevisionRef.current
    const mcpIcons = includeMcpIcons ? mcpIconsSnapshot() : undefined
    transcriptSync.publish(runtime, {
      hasMoreHistory: runtime.hasMoreHistory,
      historyNavigation: runtime.navigationAvailable,
      ...(mentionArtwork ? { mentionArtwork } : {}),
      ...(mcpIcons ? { mcpIcons } : {}),
      pendingPermission: pending
        ? { requestId: pending.requestId, toolName: pending.toolName, toolUseId: pending.toolUseId }
        : null,
      // Session-level facts the transcript cannot derive from a message: the
      // live-turn gate, the footer's token counter, and the compact / retry
      // indicators. Sent on every patch because each is a plain scalar.
      sessionStatus: runtime.session.status,
      streamingTokens: runtime.session.streamingTokens,
      isCompacting: runtime.session.isCompacting,
      compactingStartedAt: runtime.session.compactingStartedAt,
      isRecapping: runtime.session.isRecapping,
      compactError: runtime.session.compactError,
      apiRetry: runtime.session.apiRetry,
      pendingTurn: runtime.pendingTurn,
      projectPath: runtime.projectPath || null,
    }, hydrate)
    if (includeMentionArtwork) mentionArtworkRevisionRef.current = mentionArtworkRevision
    if (includeMcpIcons) mcpIconsRevisionRef.current = iconsRevision
    setHasTranscript(runtime.session.messages.length > 0)
    setStreaming(runtime.streaming)
    setQueuedMessages(runtime.session.queuedMessages)
    setTodos(runtime.session.todos)
    setPromptSuggestions(runtime.session.promptSuggestions)
    setSlashOutput(runtime.session.slashCommandOutput)
    setPermMode(runtime.permissionMode)
    setSandboxInfo(runtime.sandboxInfo)
    setSessionWorktree((current) => {
      const next = { ...runtime.worktree, removed: runtime.session._worktreeRemoved }
      return current.isWorktree === next.isWorktree && current.worktreePath === next.worktreePath
        && current.gitBranch === next.gitBranch && current.removed === next.removed
        ? current
        : next
    })
    setUsage((current) => (
      current.contextTokens === runtime.contextTokens
        && current.contextWindow === runtime.contextWindow
        && current.totalCostUsd === runtime.totalCostUsd
        ? current
        : { contextTokens: runtime.contextTokens, contextWindow: runtime.contextWindow, totalCostUsd: runtime.totalCostUsd }
    ))
    setRateLimit(runtime.session.rateLimitInfo)
    setPerm(pending ?? null)
    setPlan(runtime.session.pendingPlanApproval)
    setQuestion(runtime.session.pendingQuestion)
    if (runtime.sessionTitle) {
      setActiveSessionTitle(runtime.sessionTitle)
      setSessions((current) => {
        const row = current.find((item) => item.sessionId === runtime.sessionId)
        if (!row || row.title === runtime.sessionTitle) return current
        return current.map((item) => item.sessionId === runtime.sessionId
          ? { ...item, title: runtime.sessionTitle }
          : item)
      })
    }
  }
  const rememberViewState = (id: string, viewState: ChatViewState) => {
    chatViewStatesRef.current = { ...chatViewStatesRef.current, [id]: viewState }
    if (viewStateWriteTimerRef.current != null) return
    viewStateWriteTimerRef.current = setTimeout(() => {
      viewStateWriteTimerRef.current = null
      runUiAction(() => kv.set(CHAT_VIEW_STATE_KEY, JSON.stringify(chatViewStatesRef.current)), setStatus, 'failed to save view state')
    }, 250)
  }
  const handleNativeRequest = async (message: Extract<HostOutbound, { type: 'requestNative' }>) => {
    const result = await resolveNativeRequest(message, {
      subscribeDetail: async (detailRef, subscriptionId) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        return runtime.subscribeDetail(detailRef, subscriptionId)
      },
      unsubscribeDetail: async (subscriptionId) => { await runtimeRef.current?.unsubscribeDetail(subscriptionId) },
      loadNavigationIndex: async () => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        const index = await runtime.loadNavigationIndex()
        if (runtimeRef.current !== runtime) throw new Error('Session changed')
        return index
      },
      loadHistoryWindow: async (anchorId, direction) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        const result = await runtime.loadHistoryWindow(anchorId, direction)
        if (runtimeRef.current !== runtime) throw new Error('Session changed')
        return result
      },
      loadEarlier: async () => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        const messages = await runtime.loadEarlier()
        if (runtimeRef.current !== runtime) throw new Error('Session changed')
        return { messages, hasMoreHistory: runtime.hasMoreHistory }
      },
      openLink: async (url) => { await Linking.openURL(url) },
      copyText: async (text) => { await Clipboard.setStringAsync(text) },
      haptic: async (style) => {
        await Haptics.impactAsync(
          style === 'light' ? Haptics.ImpactFeedbackStyle.Light
            : style === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy
              : Haptics.ImpactFeedbackStyle.Medium,
        )
      },
      // Mirrors `clearSent`: the native editor owns the text when it is mounted,
      // and writing through `changeText` instead would leave the two out of sync.
      saveWidgetTemplate: async (input) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        await runtime.saveWidgetTemplate(input)
      },
      setDraft: async (text) => {
        if (composerDraft.editorRef.current) composerDraft.editorRef.current.replaceText(text)
        else composerDraft.changeText(text)
      },
      codexAsyncQuestionAnswer: async (messageId, itemId, answers) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        await runtime.answerCodexAsyncQuestion(messageId, itemId, answers)
      },
      codexPlanApproval: async (messageId, status, feedback) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        runtime.respondCodexPlan(messageId, status, feedback)
      },
      previewFile: (path, line, root) => filePreview.open(path, line, root),
      previewImage: async (target) => { filePreview.showImage(target) },
      previewMermaid: async (svg) => { filePreview.showMermaid(svg) },
      loadImage: async (path, confirmed, root) => {
        const client = clientRef.current
        if (!client || !project) throw new Error('no active project')
        return loadInlineImage({ host: client, transport: activeTransport, projectPath: project.path, sessionId, path, root, confirmed })
      },
      loadVideoPoster: async (path, root) => {
        const client = clientRef.current
        if (!client || !project) throw new Error('no active project')
        return loadVideoPoster({ host: client, projectPath: project.path, sessionId, path, root })
      },
      loadTextFile: async (path, root) => {
        const client = clientRef.current
        if (!client || !project) throw new Error('no active project')
        return loadTextFile({ host: client, projectPath: project.path, sessionId, path, root })
      },
      loadAttachment: async (messageId, ref) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        return runtime.loadAttachment(messageId, ref)
      },
      resolveFavicon: async (url, isDark) => {
        const client = clientRef.current
        if (!client) throw new Error('not connected')
        return requestLinkFavicon(client, url, isDark)
      },
      openFile: async (path) => {
        if (!project) throw new Error('no active project')
        const target = resolveRemoteFilePath(project.path, path)
        setFilesOrigin('session')
        setScreen('files')
        if (!await loadDirectory(parentRemotePath(target))) throw new Error(`cannot open ${path}`)
        setStatus(`Opened ${target}`)
      },
    })
    inject(webRef, result)
  }
  const recoverChatView = (message: string) => {
    const now = Date.now()
    const recovery = registerFatalChatViewError(fatalReloadRef.current, now)
    fatalReloadRef.current = recovery.state
    setStatus(`chat renderer failed: ${message}`)
    if (recovery.reload) webRef.current?.reload()
  }
  const handleFatalChatViewError = (message: Extract<HostOutbound, { type: 'error' }>) => {
    recoverChatView(message.message)
  }

  const handleChatViewMessage = (raw: string) => {
    let message: HostOutbound
    try {
      message = JSON.parse(raw) as HostOutbound
    } catch {
      return
    }
    if (transcriptSync.receive(message)) return
    if (message.type === 'ready') {
      inject(webRef, webViewTheme)
      inject(webRef, { type: 'setViewport', fontScale, locale })
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
      // The renderer can come up while a new session is still being created.
      // Theme still has to land; hydrate waits until the runtime exists.
      if (!runtimeRef.current) return
      syncSheets(runtimeRef.current, true)
      const saved = restoredChatWindow(chatViewStatesRef.current[runtimeRef.current.sessionId])
      if (saved) inject(webRef, saved)
      return
    }
    if (message.type === 'viewState') {
      const id = runtimeRef.current?.sessionId
      if (id) rememberViewState(id, message)
      return
    }
    if (message.type === 'requestNative') {
      void handleNativeRequest(message)
      return
    }
    if (message.type === 'error' && message.fatal) handleFatalChatViewError(message)
  }
  const rememberPairing = async (row: SavedPairing) => {
    const next = upsertPairing(await loadPairings(kv), row)
    await savePairings(kv, next)
    setPairings(next)
  }
  const updatePairings = async (update: (current: SavedPairing[]) => SavedPairing[]) => {
    const next = update(await loadPairings(kv))
    await savePairings(kv, next)
    setPairings(next)
  }
  const connectGenerationRef = useRef(0)
  const connectWithSecret = async (relayUrl: string, secret: string, lanHostPort?: string, hostName?: string, desktopDeviceId?: string) => {
    networkLedger.mark('connect')
    const connectGeneration = ++connectGenerationRef.current
    const activeDeviceId = deviceId || await loadOrCreateMobileId()
    if (connectGeneration !== connectGenerationRef.current) return
    if (!deviceId) setDeviceId(activeDeviceId)
    await remoteDraftsRef.current.park()
    if (connectGeneration !== connectGenerationRef.current) return
    composerSwitchRef.current(null)
    composerDraft.replaceWith(EMPTY_COMPOSER_DRAFT)
    suggestions.applyProgrammatic('')
    setAttachments([])
    setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
    reconnectControllerRef.current?.cancel()
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    suppressReconnectRef.current = true
    clientRef.current?.disconnect()
    suppressReconnectRef.current = false
    clientRef.current = null
    clearActiveSession()
    setProjects([]); setSessions([]); setHarnessOptions([]); setProject(null)
    workspaceCacheRef.current.persistence?.dispose()
    const pairingId = desktopDeviceId || hostName || relayUrl
    setActivePairingId(pairingId)
    const persisted = new PersistedWorkspace(kv, pairingId)
    await persisted.load()
    if (connectGeneration !== connectGenerationRef.current) { persisted.dispose(); return }
    const cache = new WorkspaceListCache(persisted)
    // Initialize once, before showing cached data. Revalidation must never clear
    // text/attachments typed into this landing or replace a session opened there.
    remoteDraftsRef.current.begin()
    const initialShellRequest = shellDetailsRequestRef.current
    const cachedProjects = persisted.get<Project[]>('projects')
    let cachedProject: Project | undefined
    if (Array.isArray(cachedProjects)) {
      const validProjects = cachedProjects.filter(row => row && typeof row.path === 'string' && typeof row.name === 'string')
      cachedProject = validProjects[0]
      setProjects(validProjects)
      if (validProjects[0]) { setProject(validProjects[0]); setScreen('chat') }
    }
    const cachedHarnesses = persisted.get<RemoteHarnessOption[]>('harness-options')
    if (Array.isArray(cachedHarnesses)) setHarnessOptions(cachedHarnesses.filter(row => row && typeof row.provider === 'string'))

    networkLedger.checkpoint('cache-loaded')
    const { client, reconnectController } = createMobileRelayConnection({
      onEvents: (events, epoch) => {
        if (connectGeneration !== connectGenerationRef.current) return
        logRelayEventTypes(events)
        remoteDraftsRef.current.ingest(events)
        workspaceActivity.ingest(events)
        const removed = sessionRemovalStatus(events, runtimeRef.current, epoch)
        if (removed) {
          composerSwitchRef.current(null)
          clearActiveSession()
          returnToWorkspace()
          setStatus(removed === 'Desktop disconnected this session' ? '' : removed)
          return
        }
        // Read off the raw batch, before ChatRuntime: the drawer has to stay
        // current even when no session is open and there is no runtime to ingest.
        const invalidated = sessionListInvalidations(events)
        if (invalidated.length) {
          for (const path of invalidated) cache.invalidate(path)
          setSessionListRevision((n) => n + 1)
        }
        additionalDirsRef.current.ingest(events)
        runtimeRef.current?.ingest(events, epoch)
      },
      onTerminal: (payload) => termRuntimeRef.current?.ingest(payload),
      restore: async (activeClient) => {
        invalidateGitResources(activeClient)
        await remoteDraftsRef.current.reconnect().catch((error) => setStatus(error instanceof Error ? error.message : 'Could not restore drafts'))
        markHarnessResourcesStale(activeClient)
        await loadMcpIcons(activeClient, runtimeRef.current?.projectPath)
        const runtime = runtimeRef.current
        if (!runtime) return activeClient.releaseBuffer().epoch
        await runtime.reopen()
        termRuntimeRef.current?.recover()
        return runtime.epoch
      },
      currentEpoch: (activeClient) => runtimeRef.current?.epoch ?? activeClient.buffer.epoch,
      onConnection: (state, epoch) => {
        if (connectGeneration !== connectGenerationRef.current) return
        // A socket that was down missed every invalidation sent meanwhile.
        if (state === 'connected' && connectionRef.current?.state !== 'connected') {
          cache.invalidateAll()
          setSessionListRevision((n) => n + 1)
        }
        connectionRef.current = { state, epoch }
        setConnectionState(state)
        inject(webRef, { type: 'setConnection', state, epoch })
        // The row falls back to discovery's verdict now; make sure it is current.
        if (state === 'offline') void discovery.refresh({ reset: false })
        // Connection feedback has one structured home in the header/sidebar.
        // Clear unrelated transient copy instead of painting a second status row.
        setStatus('')
      },
      onStatus: () => { /* DeviceStatus + reconnect own connection feedback. */ },
      onReconnectInfo: setReconnect,
      isDesktopOnline: () => checkRelayDesktopOnline({ relayUrl, masterSecret: secret }).catch(() => false),
      onShutdown: () => {
        setConnectionState('offline')
        setStatus('')
        setScreen('pair')
      },
      onKicked: () => {
        setConnectionState('offline')
        setStatus('')
        setScreen('pair')
      },
      suppressDisconnect: () => suppressReconnectRef.current,
    })
    bindHarnessPersistence(client, persisted)
    reconnectControllerRef.current = reconnectController
    clientRef.current = client
    workspaceCacheRef.current = cache
    setWorkspaceCache(cache)
    const hp = (lanHostPort ?? lan).trim()
    if (hp.includes(':')) {
      const [host, port] = hp.split(':')
      await client.connectLan(host, Number(port), secret, {
        deviceId: activeDeviceId,
        deviceName: getMobileDeviceName(),
      })
    } else {
      await client.connectRelay({
        relayUrl,
        masterSecret: secret,
        deviceId: activeDeviceId,
        deviceName: getMobileDeviceName(),
      })
    }
    if (connectGeneration !== connectGenerationRef.current) return
    setActiveTransport(client.transport)
    await rememberPairing({
      id: desktopDeviceId || hostName || relayUrl,
      relayUrl,
      secret,
      hostName,
      lan: hp.includes(':') ? hp : undefined,
      desktopDeviceId,
    })
    if (connectGeneration !== connectGenerationRef.current) return
    // Every await here is a full round trip, and over the relay each one is
    // hundreds of milliseconds; independent requests go out together.
    // The harness list is already ordered and labelled the way the host's own
    // new-session surface shows them.
    const [res, options] = await Promise.all([
      client.request({ type: 'list_projects', requestId: randomId() } as RemoteCommand) as Promise<{
        projects?: Project[]
        error?: string
      }>,
      client.request({ type: 'list_harness_options', requestId: randomId() } as RemoteCommand)
        .then((result) => {
          const response = result as ListHarnessOptionsResponse | null
          return response && !('error' in response) ? response.options : []
        }).catch((): RemoteHarnessOption[] => []),
    ])
    if (clientRef.current !== client) return
    if (res.error) throw new Error(res.error)
    const projectRows = res.projects ?? []
    persisted.set('projects', projectRows)
    persisted.set('harness-options', options)
    setProjects(projectRows)
    if (clientRef.current !== client) return
    setHarnessOptions(options)
    if (shellDetailsRequestRef.current !== initialShellRequest || runtimeRef.current || sessionTransitionRef.current.isActive) return
    const initialProject = projectRows.find(row => row.path === cachedProject?.path) ?? projectRows[0]
    if (initialProject) {
      // Warm only the selected harness; another provider may start a process
      // merely to list models and is loaded when the user chooses it.
      await openProject(initialProject, false)
      if (clientRef.current !== client || shellDetailsRequestRef.current !== initialShellRequest + 1 || runtimeRef.current || sessionTransitionRef.current.isActive) return
      const system = peekHarnessResource(client, 'get_system_info', initialProject.path, selectedProvider)
      if (system) applySystemInfo(selectedProvider, system)
      const resources = peekHarnessResource(client, 'get_project_resources', initialProject.path, selectedProvider)
      setWorkspaceDirs(resources?.workspaceDirs ?? [])
      if (!cachedProject) setScreen('chat')
    } else {
      await loadMcpIcons(client)
      if (clientRef.current !== client) return
      // Nothing to run a session in yet — land on the picker, which owns Add Project.
      setScreen('project-picker')
    }
    setStatus('')
    networkLedger.checkpoint('landing-ready')
  }

  /**
   * Tapping a device it could not reach used to fail with a transport error.
   * Probe once first so an offline desktop is named as such, and dial only the
   * LAN address discovery just confirmed. The address stored at pairing time is
   * a probe candidate, never a dial target: off the desktop's network it is a
   * dead route, and dialling it would time out where the relay would have
   * connected — the row said Online because the relay answered.
   */
  const connectToPairing = async (item: SavedPairing) => {
    if (connectingPairingId) return
    setConnectingPairingId(item.id)
    try {
      if (!isReachable(discovery.statusOf(item))) {
        await discovery.refresh({ reset: false })
        if (!isReachable(discovery.statusOf(item))) {
          return
        }
      }
      const discovered = discovery.lanAddressOf(item.id)
      const lanHostPort = discovered ? `${discovered.host}:${discovered.port}` : undefined
      await connectWithSecret(item.relayUrl, item.secret, lanHostPort, item.hostName, item.desktopDeviceId)
    } catch {
      // The device row moves from Connecting back to Offline; connection
      // failures do not create a second, page-level status message.
    } finally {
      setConnectingPairingId(null)
    }
  }

  const onPair = async (value: string = paste) => {
    const raw = normalizePairingInput(value)
    try {
      if (isPairingQrInput(raw)) {
        const qr = parsePairQr(raw)
        const activeDeviceId = deviceId || await loadOrCreateMobileId()
        if (!deviceId) setDeviceId(activeDeviceId)
        pairingCancelledRef.current = false
        const { code: c, done } = startPairingHandshake({
          qr,
          mobileDeviceId: activeDeviceId,
          deviceName: getMobileDeviceName(),
          // Held so Cancel can close the socket; the handshake exposes no other
          // way to abort, and clearing the code alone would leave it running.
          openSocket: (url) => {
            const socket = new WebSocket(url)
            pairingSocketRef.current = socket
            return socket as never
          },
        })
        setCode(c)
        setStatus('Confirm this code on the desktop')
        const paired = await done
        pairingSocketRef.current = null
        setCode(null)
        await connectWithSecret(paired.relayUrl || qr.relayUrl, paired.masterSecret, undefined, paired.hostName, qr.desktopDeviceId)
        return
      }
      const json = JSON.parse(raw) as { relayUrl?: string; secret?: string; url?: string }
      const url = json.relayUrl ?? json.url
      if (!url || !json.secret) throw new Error('JSON needs relayUrl and secret')
      await connectWithSecret(url, json.secret)
    } catch (e) {
      pairingSocketRef.current = null
      setCode(null)
      // A cancelled handshake fails by design; do not report it as an error.
      setStatus(pairingCancelledRef.current ? '' : e instanceof Error ? e.message : 'pair failed')
    }
  }

  const cancelPairing = () => {
    pairingCancelledRef.current = true
    pairingSocketRef.current?.close()
    pairingSocketRef.current = null
    setCode(null)
    setStatus('')
  }

  usePairingDeepLink(onPair)

  const openScanner = async () => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()
    if (!permission.granted) {
      setStatus('Camera permission is required to scan a pairing QR')
      return
    }
    scanningRef.current = false
    setScannerOpen(true)
  }

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    if (!scannerOpen || scanningRef.current) return
    scanningRef.current = true
    setScannerOpen(false)
    setPaste(result.data)
    void onPair(result.data)
  }
  const openProject = async (p: Project, parkDraft = true) => {
    const client = clientRef.current
    if (!client) return
    systemInfoRequestRef.current++
    const projectRequest = ++shellDetailsRequestRef.current
    if (parkDraft && p.path !== project?.path) await remoteDrafts.park()
    if (clientRef.current !== client || projectRequest !== shellDetailsRequestRef.current) return
    const cache = workspaceCacheRef.current
    const listRevision = cache.revisionOf(p.path)
    if (p.path !== project?.path) {
      setBranches([]); setCheckedOutBranches([]); setWorktreeInfo(null); setWorktreeDirty({})
    }
    // Independent reads overlap latency. Only the selected harness is loaded.
    const [, , page] = await Promise.all([
      preloadHarnessResources(client, p.path, [selectedProvider]),
      loadMcpIcons(client, p.path),
      readProjectSessions(client, p.path),
      refreshGitInfo(p.path),
    ])
    if (clientRef.current !== client || projectRequest !== shellDetailsRequestRef.current) return
    setProject(p)
    setSessions(page.sessions)
    // This page is the list the drawer would otherwise read again on its next open.
    cache.store(p.path, { rows: page.sessions, total: page.totalCount, revision: listRevision })
  }

  const loadShellDetails = async (provider: HarnessId = selectedProvider, p = project, refreshCatalog = false, includeWorktreeDirty = false) => {
    const client = clientRef.current
    if (!client || !p) return
    const request = ++systemInfoRequestRef.current
    const shellRequest = ++shellDetailsRequestRef.current
    const details = await fetchShellDetails(client, p.path, provider, refreshCatalog, includeWorktreeDirty)
    if (shellRequest !== shellDetailsRequestRef.current || clientRef.current !== client) return
    replaceGitInfo(details.git)
    setWorkspaceDirs(details.workspaceDirs)
    setWorktreeInfo(details.worktree)
    setWorktreeDirty(details.worktreeDirty)
    // No `current` here: the hook already remembers what the user claimed on
    // this harness, and handing it back its own rendered state is what used to
    // make the desktop's configured defaults unreachable.
    if (details.system && request === systemInfoRequestRef.current) applySystemInfo(provider, details.system)
    setBranches(details.branches)
    setCheckedOutBranches(details.checkedOutBranches)
  }

  const refreshModels = async () => {
    const client = clientRef.current
    if (!client || !project) throw new Error('Connect to a desktop to refresh models')
    const request = ++systemInfoRequestRef.current
    const info = await requestHarnessResource(client, 'get_system_info', project.path, selectedProvider, true)
    if (request !== systemInfoRequestRef.current || clientRef.current !== client) return
    if (info.error) throw new Error(info.error)
    applySystemInfo(selectedProvider, info)
  }

  // Model and effort ride the next send. Writing them through
  // set_session_settings made a visit-local pick look like the session's
  // identity after switching away and back.
  const selectSessionModel = (model: string) => {
    harnessSelection.selectModel(model)
  }

  const selectSessionEffort = (effort: string) => {
    setSelectedEffort(effort)
  }

  const selectSessionMode = (mode: string) => {
    harnessSelection.selectMode(mode)
    runtimeRef.current?.setSessionSettings(
      selectedProvider === 'dsh' ? { agentPreset: mode } : { mode },
    )
  }

  const selectSessionProvider = (apiProviderId: string | null) => {
    harnessSelection.selectProvider(apiProviderId)
    runtimeRef.current?.setSessionApiProviderId(apiProviderId)
  }

  // App settings are host-independent, so this no longer warms the shell details
  // the old project-settings screen needed.
  useEffect(() => {
    const client = clientRef.current
    if (!client || !project) return
    return subscribeHarnessResources(client, (type, path, provider, value) => {
      if (clientRef.current !== client || path !== project.path || provider !== selectedProvider) return
      if (type === 'get_system_info') applySystemInfo(selectedProvider, value as RemoteSystemInfo)
      else setWorkspaceDirs((value as { workspaceDirs?: string[] }).workspaceDirs ?? [])
    })
  }, [connectionState, project?.path, selectedProvider, applySystemInfo])

  const openSettings = () => setScreen('settings')

  const openFiles = (origin: FilesOrigin = 'settings') => {
    const p = project
    if (!p) return
    setFilesOrigin(origin)
    setBrowserKind('project')
    setFinderOpen(false)
    setScreen('files')
    runUiAction(() => loadDirectory(p.path), setStatus, 'failed to load directory')
    // Colours are a nicety, so a repo-less folder or a git hiccup must not stop the
    // listing from appearing — this deliberately does not go through runUiAction.
    void gitStatus.refresh(p.path).catch(() => {})
  }

  const refreshFiles = () => {
    runUiAction(() => directory.reload(), setStatus, 'failed to refresh folder')
    if (browserKind === 'project' && project) void gitStatus.refresh(project.path).catch(() => {})
  }

  const createFolder = (name: string) => {
    const client = clientRef.current
    if (!client) return
    void client.request({
      type: 'create_directory', requestId: randomId(), path: directoryPath, name,
    } as RemoteCommand).then((response) => {
      const error = (response as { error?: string }).error
      if (error) { setFolderPrompt((current) => current && { ...current, error }); return }
      setFolderPrompt(null)
      runUiAction(() => directory.load(joinRemotePath(directoryPath, name)), setStatus, 'failed to open folder')
    }).catch((cause) => {
      setFolderPrompt((current) => current && { ...current, error: cause instanceof Error ? cause.message : 'Could not create folder' })
    })
  }

  // File rows in the browser take the same path as a transcript chip: every
  // file opens the fullscreen preview, which decides how to show it.
  const previewFile = (path: string) => filePreview.open(path)

  const bindRuntime = (client: RelayClient) => {
    setStatus('')
    runtimeRef.current?.dispose()
    const runtime = new ChatRuntime(client, (_session, hydrate) => {
      if (runtimeRef.current === runtime) syncSheets(runtime, hydrate)
    }, {
      onCachedHydrate: () => { if (runtimeRef.current === runtime) setSessionLoading(false) },
      onDetail: (event) => { if (runtimeRef.current === runtime) inject(webRef, { ...event, type: 'detailUpdate' }) },
      onSessionRecap: (sid) => autoRecap.markRecapShown(sid),
      transcripts: sessionTranscriptCache,
      pairingId: () => activePairingIdRef.current,
    })
    runtimeRef.current = runtime
    setTerminalUi({ writable: false, title: 'Terminal', tabs: [], activeId: '' })
    const term = new TerminalRuntime(client, (paints) => {
      for (const p of paints) inject(termRef, p)
      setTerminalUi((current) => {
        const next = term.ui
        return current.writable === next.writable
          && current.title === next.title
          && current.activeId === next.activeId
          && current.tabs === next.tabs
          ? current
          : next
      })
    }, { onEmpty: () => setScreen('chat') })
    termRuntimeRef.current = term
    return runtime
  }

  const refreshRuntimeCatalog = (runtime: ChatRuntime, provider: HarnessId, restoreSelection = false) => {
    const request = ++systemInfoRequestRef.current
    refreshSessionCatalog(() => runtime.loadSystemInfo(provider),
      () => request === systemInfoRequestRef.current && runtimeRef.current === runtime,
      (info) => applySystemInfo(
        provider,
        info,
        restoreSelection ? openedSessionSelection(provider, {
          ...runtime.session,
          permissionMode: runtime.permissionMode,
        }) : undefined,
      ),
      (error) => setStatus(error instanceof Error ? error.message : 'Could not load agent settings'))
  }
  const resetSessionChrome = () => {
    transcriptSync.reset()
    systemInfoRequestRef.current++
    setSessionWorktree({ isWorktree: false, worktreePath: null, gitBranch: null, removed: false })
    setPerm(null)
    setPlan(null)
    setQuestion(null)
    promptCollapse.reset()
    setStreaming(false)
    setHasTranscript(false)
    setTodos({})
    setPromptSuggestions([])
    setQueuedMessages([])
    setSlashOutput(null)
    setSandboxInfo(null)
    setPendingSandboxMode(null)
    setUsage({ contextTokens: 0, contextWindow: null, totalCostUsd: 0 })
    setRateLimit(null)
  }
  const clearActiveSession = () => {
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    setSessionId(null)
    setActiveSessionTitle('')
    setSessionLoading(false)
    setHasTranscript(false)
    resetSessionChrome()
    // Session-scoped folders belong to the session that had them. Left behind,
    // they would ride into the next one the landing starts.
    additionalDirsRef.current.clearSessionDirs()
  }
  const leaveActiveSession = () => {
    runUiAction(() => {
      try { leaveMobileSession(clientRef.current, runtimeRef) } finally { clearActiveSession() }
    }, setStatus, 'leave session failed')
  }
  const failSessionTransition = (error: unknown) => {
    switchComposerDraft(null)
    clearActiveSession()
    returnToWorkspace()
    setStatus(error instanceof Error ? error.message : 'session transition failed')
  }
  const openSession = (row: SessionRow, targetProject = project) => sessionTransitionRef.current.run(async () => {
    const client = clientRef.current
    const p = targetProject
    if (!client || !p) return
    await remoteDrafts.park()
    if (runtimeRef.current?.sessionId === row.sessionId && runtimeRef.current.projectPath === p.path) {
      setScreen('chat')
      return
    }
    switchComposerDraft(row.sessionId, p.path)
    setSessionLoading(true)
    try {
      const previousId = runtimeRef.current?.sessionId
      if (previousId && previousId !== row.sessionId) client.send({ type: 'leave_session', sessionId: previousId })
      resetSessionChrome()
      setSessionId(row.sessionId)
      setActiveSessionTitle(row.title || 'Untitled')
      const provider = (row.provider ?? 'claude') as HarnessId
      // Until the new catalog arrives, omit model overrides and let this
      // session retain its host-owned settings instead of sending the last
      // session's model/effort with a quick first message.
      harnessSelection.resetForProvider(provider, row.acpAgentId ?? null)
      setHarness(provider)
      const runtime = bindRuntime(client)
      setScreen('chat')
      await runtime.open(p.path, row.sessionId)
      setSessionLoading(false)
      console.info('[SessionRestore]', runtime.restoreMetrics)
      refreshRuntimeCatalog(runtime, provider, true)
      // A turn may have ended while this session was not on screen — the chip
      // only watches the open session, so coming back has to re-read the tree.
      void refreshGitInfo(p.path).catch(() => {})
    } finally {
      setSessionLoading(false)
    }
  }).catch(failSessionTransition)

  /**
   * Runs one session-list command. The list applies its own change only when
   * this resolves true, so a rejected command leaves the row exactly as it was
   * and the status line carries the reason.
   */
  const runSessionOp = async (op: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    try {
      await op()
      return true
    } catch (error) {
      setStatus(error instanceof Error && error.message ? error.message : fallback)
      return false
    }
  }

  const pinSession = async (row: SessionRow, pinned: boolean, targetProject = project) => {
    const client = clientRef.current
    const p = targetProject
    if (!client || !p) throw new Error('no active project')
    const result = await client.request({
      type: 'pin_session',
      requestId: randomId(),
      projectPath: p.path,
      sessionId: row.sessionId,
      pinned,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? `failed to ${pinned ? 'pin' : 'unpin'} session`)
    if (p.path === project?.path) {
      setSessions((current) => current.map((item) => (
        item.sessionId === row.sessionId ? { ...item, isPinned: pinned } : item
      )))
    }
  }

  const removeSession = async (row: SessionRow, type: 'archive_session' | 'delete_session', targetProject = project) => {
    const client = clientRef.current
    const p = targetProject
    if (!client || !p) throw new Error('no active project')
    const result = await client.request({
      type,
      requestId: randomId(),
      projectPath: p.path,
      sessionId: row.sessionId,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? `failed to ${type === 'archive_session' ? 'archive' : 'delete'} session`)

    if (p.path === project?.path) setSessions((current) => current.filter((item) => item.sessionId !== row.sessionId))
    if (sessionId === row.sessionId) {
      switchComposerDraft(null)
      leaveActiveSession()
      returnToWorkspace()
    }
  }

  const sessionListActions = {
    onPinSession: (p: Project, row: SessionRow, pinned: boolean) =>
      runSessionOp(() => pinSession(row, pinned, p), `failed to ${pinned ? 'pin' : 'unpin'} session`),
    onArchiveSession: (p: Project, row: SessionRow) =>
      runSessionOp(() => removeSession(row, 'archive_session', p), 'failed to hide session'),
    onDeleteSession: (p: Project, row: SessionRow) =>
      runSessionOp(() => removeSession(row, 'delete_session', p), 'failed to delete session'),
  }

  const startNewSession = async (targetProject = project) => {
    await remoteDrafts.park()
    switchComposerDraft(null, targetProject?.path)
    composerDraft.replaceWith(EMPTY_COMPOSER_DRAFT)
    setAttachments([])
    suggestions.applyProgrammatic('')
    leaveActiveSession()
    setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
    setStatus('')
    setActiveSessionTitle('New session')
    setScreen('chat')
    const client = clientRef.current
    if (client && targetProject) {
      const system = peekHarnessResource(client, 'get_system_info', targetProject.path, selectedProvider)
      if (system) applySystemInfo(selectedProvider, system)
      const resources = peekHarnessResource(client, 'get_project_resources', targetProject.path, selectedProvider)
      setWorkspaceDirs(resources?.workspaceDirs ?? [])
    }
    remoteDrafts.begin()
  }
  /** Open a project for a new session — the picker's only exit that keeps state. */
  const chooseProject = (target: Project) =>
    runUiAction(async () => {
      if (!sessionId && remoteDrafts.activeId) {
        await openProject(target, false)
        setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
        setScreen('chat')
      } else { await openProject(target); await startNewSession(target) }
    },
      setStatus, 'failed to open project')

  const addProjectFlow = useAddProject({
    request: (command) => {
      const client = clientRef.current
      if (!client) throw new Error('Connect to a desktop to browse projects')
      return client.request(command)
    },
    onAdded: (path) => {
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
      const added = { path, name }
      setProjects((current) => current.some((row) => row.path === path) ? current : [added, ...current])
      chooseProject(added)
    },
  })

  /**
   * Close the Add Project flow onto whatever opened it. From the workspace that
   * is the drawer itself — it closed to make room for the flow, so back has to
   * put it back rather than drop the user on a project list.
   */
  const leaveAddProject = () => {
    if (addProjectOrigin === 'picker') { setScreen('project-picker'); return }
    leaveToWorkspace()
  }

  /**
   * Return to chat with the workspace drawer up again. Every page the drawer
   * opens closes it to take the screen, so leaving that page has to restore
   * it — unless the window is wide enough for the persistent sidebar, which
   * never went away.
   */
  const leaveToWorkspace = () => {
    setScreen('chat')
    if (!shouldUseTabletMultiPane(width, height, 'chat', !!project)) setSessionSwitcherOpen(true)
  }

  /**
   * The branch page is the only surface that shows file counts and diff stats.
   * Refresh here so an external checkout or a turn we weren't watching cannot
   * leave the dirty summary stale. The header chip only needs dirty/clean, and
   * that is kept current by turn-end and session-switch reads.
   */
  const openGitPage = () => {
    setScreen('branch')
    void refreshGitInfo(project?.path).catch(() => {})
    const client = clientRef.current
    const request = ++shellDetailsRequestRef.current
    if (client && project) void requestGitResource(client, 'get_git_branches', project.path).then(result => {
      if (clientRef.current === client && request === shellDetailsRequestRef.current) setBranches(result.branches ?? [])
    }).catch(() => {})
  }

  /** Checkout or create a branch on the paired desktop, then re-read git state. */
  const changeBranch = async (branch: string, type: 'switch_git_branch' | 'create_git_branch') => {
    const client = clientRef.current
    if (!client || !project) throw new Error('Connect to a desktop to change branches')
    const result = await client.request({
      type, requestId: randomId(), projectPath: project.path, branch,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (result?.ok === false) throw new Error(result.error || 'Could not change branch')
    invalidateGitResources(client, project.path)
    await loadShellDetails()
  }
  /** Switcher pick: an ACP row also pins which agent it stood for. */
  const selectHarness = (option: RemoteHarnessOption) => {
    const client = clientRef.current
    if (!client || !project) return
    const request = ++systemInfoRequestRef.current
    const apply = (info: import('@superone/shared/agent-types').RemoteSystemInfo) => {
      if (request !== systemInfoRequestRef.current || clientRef.current !== client) return
      harnessSelection.resetForProvider(option.provider, option.acpAgentId)
      applySystemInfo(option.provider, info)
      setHarness(option.provider)
      if (option.provider !== 'claude') setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
    }
    const cached = peekHarnessResource(client, 'get_system_info', project.path, option.provider)
    if (cached) apply(cached)
    else runUiAction(async () => {
      apply(await requestHarnessResource(client, 'get_system_info', project.path, option.provider))
    }, setStatus, 'failed to load agent settings')
  }
  /**
   * The first send creates the session it goes into. `turn` is that message:
   * it is painted, and the title taken from it, before the draft flush and the
   * host round trips, so the tap lands like a desktop send — bubble, title, and
   * a "Creating session…" line under it — instead of a blank wait.
   */
  const createSession = async (turn: { clientMessageId: string; text: string; images: ImageAttachment[]; title: string }) => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const selectionError = worktreeSelectionError(worktreeSelection, branches, checkedOutBranches)
    if (selectionError) {
      setStatus(selectionError)
      return
    }
    return sessionTransitionRef.current.run(async () => {
      const previousId = runtimeRef.current?.sessionId
      if (previousId) client.send({ type: 'leave_session', sessionId: previousId })
      const runtime = bindRuntime(client)
      const startupDirs = [...new Set([...workspaceDirs, ...additionalDirs.sessionDirs])]
      const id = remoteDrafts.originSessionId ?? randomId()
      // Leave the landing immediately — the first send should look like desktop,
      // not a "Starting session…" wait. Host errors still land on the status line.
      setSessionId(id)
      setActiveSessionTitle(turn.title.slice(0, 72) || 'New session')
      setScreen('chat')
      runtime.stageTurn(turn.clientMessageId, turn.text, turn.images)
      const draftControl = await remoteDrafts.prepareSend()
      await runtime.create(p.path, {
        ...draftControl,
        sessionId: id,
        provider: selectedProvider,
        ...(selectedProvider === 'acp' && selectedAcpAgentId
          ? { acpAgentId: selectedAcpAgentId }
          : {}),
        permissionMode: permMode,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        ...buildWorktreeCreateOptions(worktreeSelection, gitInfo?.branch),
        // Project folders plus anything `/add-dir session …` collected before
        // there was a session to write it to — the desktop's draft session does
        // the same, and there is no other moment these could be handed over.
        ...(harnessSupportsAdditionalDirs(selectedProvider) && startupDirs.length
          ? { additionalDirectories: startupDirs }
          : {}),
        // Only an explicit pick travels: staying silent leaves the host on its
        // own default rather than forcing whatever the chip happened to show.
        ...(pendingSandboxMode && harnessSupportsSandbox(selectedProvider)
          ? { sandboxMode: pendingSandboxMode }
          : {}),
        // A mode is a session mode for ACP and a composition preset for DeepSeek.
        ...(harnessSelection.selectedModeId
          ? selectedProvider === 'dsh'
            ? { agentPreset: harnessSelection.selectedModeId }
            : { mode: harnessSelection.selectedModeId }
          : {}),
        ...(harnessSelection.selectedProviderId !== null
          ? { apiProviderId: harnessSelection.selectedProviderId }
          : {}),
      })
      setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
      if (runtime.sessionId !== id) setSessionId(runtime.sessionId)
      // The picks made on the landing screen are already claimed in the hook —
      // the session was just created from them.
      refreshRuntimeCatalog(runtime, selectedProvider)
    }).catch(failSessionTransition)
  }

  const pendingSendKind = useRef<'send' | 'steer' | 'soon'>('send')
  const send = useComposerSend(composerDraft.editorRef, `${activePairingId}:${project?.path}:${sessionId}`, async () => {
    const kind = pendingSendKind.current
    pendingSendKind.current = 'send'
    const sentDraft = composerDraft.capture()
    const text = sentDraft.text.trim()
    if (!text && attachments.length === 0) return
    validateTurnAttachments(attachments, text)
    if (sessionTransitionRef.current.isActive) {
      setStatus('The conversation is still loading. Please send again when it is ready.')
      return
    }
    if (isManualRecapCommand(text) && shouldInterceptGrokRecap(selectedProvider, selectedAcpAgentId)) {
      const runtime = runtimeRef.current
      if (!runtime?.sessionId) return
      if (composerDraft.clearSent(sentDraft.revision) && !composerDraft.editorRef.current) suggestions.update('')
      void runtime.requestRecap()
      return
    }
    const clientMessageId = newMessageId('user')
    if (!runtimeRef.current) {
      // Keep attachment drafts until the host confirms files are readable.
      // Text-only drafts move into the staged bubble during session creation.
      const snapshot = composerDraft.exportSnapshot()
      const cleared = attachments.length === 0 && composerDraft.clearSent(sentDraft.revision)
      if (cleared && !composerDraft.editorRef.current) suggestions.update('')
      await createSession({ clientMessageId, text, images: attachments, title: sentDraft.title })
      if (!runtimeRef.current) {
        if (cleared) {
          composerDraft.replaceWith(snapshot)
          suggestions.applyProgrammatic(snapshot.text)
        }
        return
      }
    }
    const runtime = runtimeRef.current
    if (!runtime) return
    const { needsClientMessageId: queued } = composerQueuedSendFields(runtime.session.status, selectedProvider, kind)
    try {
      await runtime.send(text, {
        images: attachments,
        ...(selectedProvider === 'codex' && remoteDrafts.settings?.codexCollaborationMode
          ? { collaborationMode: remoteDrafts.settings.codexCollaborationMode } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        ...(selectedProvider === 'opencode' && harnessSelection.selectedAgentId
          ? { agent: harnessSelection.selectedAgentId }
          : {}),
        ...(selectedProvider === 'codex' ? { serviceTier: harnessSelection.serviceTier } : {}),
        ...(Object.keys(harnessSelection.modelParams).length
          ? { modelParams: harnessSelection.modelParams }
          : {}),
        clientMessageId,
        ...(queued ? { priority: 'next' as const } : {}),
        // Fold Stair into this send so it cannot race a follow-up steer RPC.
        ...(queued && kind === 'steer' ? { steer: 'now' as const } : {}),
        ...(queued && kind === 'soon' ? { steer: 'next' as const } : {}),
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'message failed')
      return
    }
    await remoteDrafts.consume()
    if (composerDraft.clearSent(sentDraft.revision) && !composerDraft.editorRef.current) suggestions.update('')
    setAttachments((current) => current.filter((item) => !attachments.includes(item)))
  }, setStatus)

  const onDraft = (text: string) => {
    composerDraft.changeText(text)
    suggestions.update(text)
  }

  /**
   * Rewrite the composer's command line and nothing else.
   *
   * Slash commands, the folder chips and `/add-dir`'s own navigation all land
   * here: anything the user typed on a later line — including mention chips,
   * which the plain editor cannot rebuild — has to survive being sent to a
   * panel and back.
   */
  const writeCommandLine = (line: string) => {
    if (composerDraft.editorRef.current) { composerDraft.editorRef.current.replaceFirstLine(line); return }
    const next = replaceFirstLine(draftRef.current, line)
    composerDraft.changeText(next)
    suggestions.applyProgrammatic(next)
  }

  /**
   * `/mcp` reports rather than writes. The status is read each time it opens:
   * a server that failed at launch may have been fixed on the desktop since,
   * and a cached list would say otherwise.
   */
  const openMcp = () => {
    const client = clientRef.current
    if (!client || !project) return
    closeComposerPanels()
    setMcp({ open: true, loading: true, rows: [] })
    void requestMcpServers(client, project.path)
      .then(({ rows, error }) => {
        if (clientRef.current !== client) return
        setMcp({ open: true, loading: false, rows, ...(error ? { error } : {}) })
      })
      .catch((error: unknown) => {
        if (clientRef.current !== client) return
        setMcp({ open: true, loading: false, rows: [], error: error instanceof Error ? error.message : 'Could not read MCP status' })
      })
  }

  /**
   * Read from the transcript each time it opens, so a run that finished while
   * the panel was shut is not shown as still going.
   */
  /**
   * Adding a working directory is browsing, and browsing is a page.
   *
   * A route rather than a width branch: at 768 pt and up the shell keeps the
   * session list beside it, so this is a detail panel on a tablet and a full
   * screen on a phone from one definition — as `worktree` and `branch` are.
   */
  const openAdditionalDirs = () => {
    additionalDirs.reset()
    setScreen('add-dir')
  }

  const openWorkflows = () => {
    closeComposerPanels()
    setWorkflowsOpen(true)
  }

  /**
   * One panel at a time. These three are opened by a command, so opening the
   * next one is the user saying they are done with the last — including the
   * previous command's output, which would otherwise outrank both.
   */
  const closeComposerPanels = () => {
    setMcp((current) => ({ ...current, open: false }))
    setWorkflowsOpen(false)
    runtimeRef.current?.clearSlashCommandOutput()
  }

  const addAttachment = async (kind: 'image' | 'pdf') => {
    try {
      const picked = kind === 'image' ? await pickChatImages(8 - attachments.length) : [await pickChatPdf()].filter(Boolean) as ImageAttachment[]
      setAttachments((current) => [...current, ...picked].slice(0, 8))
    } catch (error) { setStatus(error instanceof Error ? error.message : 'attachment failed') }
  }

  /** `targetDir` lands the file in the folder the browser is showing; the composer omits it. */
  const uploadProjectFile = async (targetDir?: string) => {
    if (!project || !clientRef.current) return
    setStatus('Uploading file…')
    try {
      const saved = await pickAndUploadProjectFile({ client: clientRef.current, projectPath: project.path,
        sessionId: sessionId ?? undefined, ...(targetDir ? { targetDir } : {}) })
      setStatus(saved ? `Uploaded to ${saved}` : 'Upload cancelled')
      // The new file only exists in the listing after a re-read.
      if (targetDir && saved) await directory.reload()
    } catch (error) { setStatus(error instanceof Error ? error.message : 'upload failed') }
  }

  /** Drop the transport and everything hanging off it, back to the device list. */
  const disconnectDevice = async () => {
    ++connectGenerationRef.current
    workspaceCacheRef.current.persistence?.dispose()
    await remoteDrafts.park()
    filePreview.close()
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    switchComposerDraft(null)
    reconnectControllerRef.current?.cancel()
    suppressReconnectRef.current = true
    clientRef.current?.disconnect()
    suppressReconnectRef.current = false
    clientRef.current = null
    clearActiveSession()
    setActivePairingId(null)
    setActiveTransport(null)
    setReconnect(null)
    setConnectionState('offline')
    setScreen('pair')
  }

  const back = () => {
    if (screen === 'collab-request') {
      collab.leave()
      return
    }
    if (screen === 'collab-task') {
      setScreen('collab-request')
      return
    }
    if (screen === 'files') {
      setScreen(filesOrigin === 'session' ? 'chat' : 'settings')
      return
    }
    if (screen === 'settings') {
      setScreen('chat')
      return
    }
    if (screen === 'add-project') {
      // The flow walks its own steps back first; only the source step leaves.
      if (addProjectFlow.canGoBack) addProjectFlow.goBack()
      else leaveAddProject()
      return
    }
    if (screen === 'project-picker') {
      setScreen('chat')
      return
    }
    if (screen === 'add-dir') {
      // The page walks back out of browsing first; only the overview leaves.
      if (additionalDirs.canGoBack) additionalDirs.goBack()
      else setScreen('chat')
      return
    }
    if (screen === 'terminal' || screen === 'worktree' || screen === 'branch') {
      setScreen('chat')
      return
    }
    // Chat is the root above the device list, so back opens the workspace the
    // way the desktop keeps its sidebar there — it must not end the session.
    if (screen === 'chat') setSessionSwitcherOpen(true)
  }

  // Stable per launch so the task page's effect runs once per open, not per render.
  const collabTaskLoader = useCallback(async (): Promise<string> => {
    const request = collab.open
    if (!request || !collabTask) throw new Error('That collaboration request is no longer pending')
    if (!collabTask.taskDeferred) return collabTask.task
    const runtime = runtimeRef.current
    if (!runtime) throw new Error('No active connection')
    return runtime.loadCollabLaunchTask(request.requestId, collabTask.launchId)
  }, [collab.open, collabTask])

  const openTerminal = () => {
    const p = project
    const runtime = runtimeRef.current
    const term = termRuntimeRef.current
    if (!p || !term) return
    setScreen('terminal')
    runUiAction(() => term.open(p.path, runtime?.sessionId), setStatus, 'terminal failed')
  }

  const activePairing = pairings.find((item) => item.id === activePairingId)
  const deviceName = activePairing?.hostName ?? 'Desktop'
  const deviceStatus = activePairing ? discovery.statusOf(activePairing) : 'offline'
  // Only meaningful inside a session: on the landing the same facts are the
  // work-dir and branch chips, which the user is still choosing between.
  const sessionGit = sessionId ? describeSessionGit({
    isWorktree: sessionWorktree.isWorktree,
    worktreePath: sessionWorktree.worktreePath,
    worktreeRemoved: sessionWorktree.removed,
    sessionBranch: sessionWorktree.gitBranch,
    projectBranch: gitInfo?.branch ?? null,
    projectHead: gitInfo?.head ?? null,
    projectDirtyFiles: gitInfo?.dirty?.files ?? 0,
    worktree: worktreeInfo,
  }) : null
  const browserMode: FileBrowserMode = browserKind === 'computer'
    ? { kind: 'computer', name: deviceName }
    : { kind: 'project', root: project?.path ?? '', name: project?.name ?? 'Files' }
  const fileSearch = useFileSearch(clientRef, browserKind === 'project' ? project?.path ?? '' : '')
  const pathCompletion = usePathAutocomplete(clientRef, gotoPath, finderOpen && browserKind === 'computer')
  const closeFinder = () => {
    fileSearch.reset()
    pathCompletion.reset()
    setGotoPath('')
    setFinderOpen(false)
  }
  const headerTitle = (route: Screen) => route === 'add-project' ? addProjectFlow.title
    : route === 'files' ? browserMode.name
    : mobileHeaderTitle(route, project?.name, activeSessionTitle, terminalUi.title, t)
  /**
   * Everything the workspace shows, wherever it is mounted: the modal drawer on
   * a phone in portrait, the persistent sidebar once the window is wide enough.
   * One object because they are one surface — a project reachable from only one
   * of them is the bug this replaced.
   */
  const workspaceList = {
    client: clientRef.current,
    projects,
    activeProject: project,
    activeSessionId: sessionId,
    sessions,
    cache: workspaceCache,
    listRevision: sessionListRevision,
    drafts: remoteDrafts.rows,
    activeDraftId: remoteDrafts.activeId,
    onOpenDraft: (row: import('@superone/shared/environment/draft-rpc').DraftListEntry) =>
      runUiAction(() => sessionTransitionRef.current.run(() => remoteDrafts.open(row)), setStatus, 'Could not open draft'),
    onDeleteDraft: (row: import('@superone/shared/environment/draft-rpc').DraftListEntry) =>
      runUiAction(() => remoteDrafts.remove(row), setStatus, 'Could not delete draft'),
    onNewSession: (p: Project) => runUiAction(async () => { await openProject(p); await startNewSession(p) }, setStatus, 'failed to open project'),
    onOpenSession: (p: Project, row: SessionRow) => runUiAction(async () => { if (p.path !== project?.path) await openProject(p); await openSession(row, p) }, setStatus, 'failed to open session'),
    ...sessionListActions,
    onSearch: () => setScreen('session-search'),
    onAddProject: () => { setAddProjectOrigin('workspace'); setScreen('add-project') },
  }

  const tabletMultiPane = shouldUseTabletMultiPane(width, height, screen, !!project)

  /**
   * The header is part of each scene rather than a bar above the navigator:
   * it has to slide with the page. Mounted above the stack it appeared the
   * instant `screen` changed, which shrank the stack's frame while the outgoing
   * page was still on screen — the device list visibly dropped by half the bar
   * before New Session slid in, and the reverse jump played on the way back.
   * Inside the scene the frame is constant and the outgoing page keeps the bar
   * it had, so every gate here keys on the scene's `route`, not on `screen`.
   */
  const renderHeader = (route: Screen) => (
    <>
      <MobileHeader
      pendingCount={workspaceActivity.pendingCount}
      route={route}
      title={headerTitle(route)}
      subtitle={project?.name}
      provider={selectedProvider}
      hasSession={!!sessionId}
      sessionId={sessionId}
      deviceStatus={deviceStatus}
      reconnect={reconnect}
      sidebarVisible={tabletMultiPane}
      git={sessionGit}
      onOpenBranch={openGitPage}
      onBack={back}
      onSwitchSession={() => setSessionSwitcherOpen(true)}
      onOpenTerminal={openTerminal}
      terminal={route === 'terminal' ? {
        tabs: terminalUi.tabs,
        activeId: terminalUi.activeId,
        onSelect: (terminalId) => termRuntimeRef.current?.select(terminalId),
        onCreate: () => {
          const p = project
          if (!p) return
          runUiAction(() => termRuntimeRef.current?.create(p.path, runtimeRef.current?.sessionId), setStatus, 'terminal failed')
        },
        onClose: (terminalId) => termRuntimeRef.current?.closeTab(terminalId),
      } : undefined}
      onOpenFiles={() => openFiles('session')}
      onOpenFilesRoot={() => runUiAction(() => loadDirectory(fileBrowserHome(browserMode, directoryPath)), setStatus, 'failed to load directory')}
      files={route === 'files' ? { kind: browserKind, finderOpen,
        onToggleFinder: () => {
          if (finderOpen) { closeFinder(); return }
          if (browserKind === 'computer') setGotoPath(`${directoryPath.replace(/\/+$/, '')}/`)
          setFinderOpen(true)
        },
        onUploadFile: () => void uploadProjectFile(directoryPath),
        onNewFolder: () => setFolderPrompt({ value: '' }),
      } : undefined}
      onConfirm={route === 'worktree'
        ? () => { setWorktreeSelection(worktreeDraft); setScreen('chat') }
        : route === 'add-project' && addProjectFlow.confirmLabel
          ? addProjectFlow.confirm
          // Only while browsing: the overview has nothing to commit, it hands
          // off to the browser. Same slot Add Project commits from.
          : route === 'add-dir' && additionalDirs.canGoBack
            ? () => runUiAction(additionalDirs.confirm, setStatus, 'could not add that folder')
            : undefined}
      confirmLabel={route === 'add-project' ? addProjectFlow.confirmLabel ?? undefined
        : route === 'add-dir' && additionalDirs.canGoBack ? 'Add' : undefined}
      launchCount={route === 'collab-request' ? collab.open?.payload.launches.length : undefined}
      onAddProject={route === 'project-picker'
        ? () => { setAddProjectOrigin('picker'); setScreen('add-project') }
        : undefined}
      confirmDisabled={route === 'add-project'
        ? addProjectFlow.busy
        // A folder the host has not confirmed exists cannot be added, so the
        // action stays off rather than failing after the tap.
        : route === 'add-dir'
          ? additionalDirs.busy || !additionalDirs.resolvedPath
          : !!worktreeSelectionError(worktreeDraft, branches, checkedOutBranches)}
      />
      <StatusBanner message={status} onDismiss={() => setStatus('')} />
    </>
  )

  // Android's back button is the hardware twin of the swipe the navigator no
  // longer accepts on chat, so it opens the workspace for the same reason.
  // While the drawer is up its own handler (registered later, so asked first) consumes back.
  useEffect(() => {
    if (screen !== 'chat' || tabletMultiPane) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setSessionSwitcherOpen(true); return true })
    return () => back.remove()
  }, [screen, tabletMultiPane])

  /**
   * The composer shows exactly one surface, chosen here.
   *
   * These are all panels a command opened, and they close each other, so the
   * chain only has to settle ties. Below them the command list and the mention
   * list take the same slot inside `ChatComposer` — which is what stops a
   * command list from being painted under the panel that command opened.
   */
  const composerOverlay = slashOutput ? (
    <SlashOutputPanel output={slashOutput} onDismiss={() => runtimeRef.current?.clearSlashCommandOutput()} />
  ) : mcp.open ? (
    <McpPanel visible servers={mcp.rows} loading={mcp.loading} error={mcp.error}
      onDismiss={() => setMcp((current) => ({ ...current, open: false }))} />
    ) : workflowsOpen ? (
    <WorkflowsPanel visible onDismiss={() => setWorkflowsOpen(false)}
      runs={workflowRunRows(runtimeRef.current?.session.messages ?? [])} />
  ) : undefined

  return (
    <SessionActivityContext.Provider value={workspaceActivity.sessions}>
    <SafeAreaView style={styles.root}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      <MobileKeyboardFrame>
        {/* Scenes (and their headers) live in the detail column so the
            persistent sidebar can occupy the full window height. On a phone
            the column is the whole frame, so the bar still sits at the top. */}
        <View style={styles.contentRow}>
        {tabletMultiPane && project ? (
          <WorkspaceSidebar {...workspaceList}
            deviceName={deviceName}
            deviceStatus={deviceStatus}
            reconnect={reconnect}
            onDisconnect={disconnectDevice}
            onOpenSettings={openSettings}
          />
        ) : null}
          <View style={styles.mainPane}>
            <View style={styles.flex}>
            <MobileNavigator
            route={screen}
            filesOrigin={filesOrigin}
            addProjectOrigin={addProjectOrigin}
            onRouteChange={(route) => {
              // A swipe out of Add Project pops to chat without going through
              // `back`, so the drawer it was opened from is restored here too.
              if (screen === 'add-project' && route === 'chat' && addProjectOrigin === 'workspace') {
                leaveAddProject()
                return
              }
              // Session search is only reachable from the drawer, so swiping
              // it away restores the drawer the same way Cancel does.
              if (screen === 'session-search' && route === 'chat') {
                leaveToWorkspace()
                return
              }
              // Chat cannot be swiped off the stack (see MobileNavigator), so
              // reaching the device list means the transport is already gone —
              // but a stray pop must still not leave a session held open.
              if (screen === 'chat' && route === 'pair' && sessionId) {
                switchComposerDraft(null)
                leaveActiveSession()
              }
              // The swipe and Android's back button pop the request page the
              // same way the header's Back does: the request is rejected.
              if (screen === 'collab-request' && route === 'chat') collab.leave()
              setScreen(route)
            }}
            renderScene={(route) => (
              <View style={styles.flex}>
              {renderHeader(route)}
              <View style={isFullBleedScreen(route) ? styles.flex : styles.page}>
      {route === 'pair' ? (
        <PairingsScreen
          scannerOpen={scannerOpen}
          paste={paste}
          lan={lan}
          code={code}
          pairings={pairings}
          statusOf={discovery.statusOf}
          reconnect={reconnect}
          activePairingId={activePairingId}
          connectingPairingId={connectingPairingId}
          refreshing={discovery.refreshing}
          onRefresh={() => void discovery.refresh({ reset: true })}
          onBarcodeScanned={onBarcodeScanned}
          onCancelScanner={() => setScannerOpen(false)}
          onPasteChange={setPaste}
          onLanChange={setLan}
          onPair={() => void onPair()}
          onCancelPairing={cancelPairing}
          onOpenScanner={() => runUiAction(openScanner, setStatus, 'camera failed')}
          onConnect={(item) => void connectToPairing(item)}
          onRename={(item, name) => runUiAction(
            () => updatePairings((current) => current.map((pairing) => pairing.id === item.id ? { ...pairing, name } : pairing)),
            setStatus,
            'failed to rename device',
          )}
          onForget={(item) => runUiAction(async () => {
            if (activePairingId === item.id) await disconnectDevice()
            if (workspaceCacheRef.current.persistence?.pairingId === item.id) await workspaceCacheRef.current.persistence.forget()
            else await new PersistedWorkspace(kv, item.id).forget()
            clearFilePreviewCache(item.id)
            await updatePairings((current) => current.filter((pairing) => pairing.id !== item.id))
          }, setStatus, 'failed to forget device')}
        />
      ) : null}

      {route === 'settings' ? (
        <ConnectedAppSettingsScreen />
      ) : null}

      {route === 'files' ? (finderOpen ? (
        browserKind === 'computer' ? <FileFinderView
          query={gotoPath}
          busy={pathCompletion.loading}
          onQuery={setGotoPath}
          finder={{
            kind: 'goto',
            suggestions: pathCompletion.suggestions,
            onComplete: (name) => setGotoPath(completeTypedPath(gotoPath, name)),
            onSubmit: () => {
              const target = gotoPath.trim().replace(/\/+$/, '') || '/'
              closeFinder()
              runUiAction(() => loadDirectory(target), setStatus, 'failed to open folder')
            },
          }}
        /> : <FileFinderView
          query={fileSearch.query}
          busy={fileSearch.searching}
          onQuery={fileSearch.setQuery}
          finder={{
            kind: 'search',
            root: project?.path ?? '',
            results: fileSearch.results,
            searched: fileSearch.searched,
            onOpenDirectory: (path) => {
              closeFinder()
              runUiAction(() => loadDirectory(path), setStatus, 'failed to load directory')
            },
            onOpenFile: (path) => runUiAction(() => previewFile(path), setStatus, 'failed to open file'),
          }}
        />
      ) : (
        <FilesScreen
          mode={browserMode}
          path={directoryPath}
          items={directoryItems}
          loading={directory.loading}
          error={directory.error}
          gitTones={gitStatus.tones}
          onRefresh={refreshFiles}
          onOpenDirectory={(path) => runUiAction(() => loadDirectory(path), setStatus, 'failed to load directory')}
          onOpenFile={(path) => runUiAction(() => previewFile(path), setStatus, 'failed to open file')}
        />
      )) : null}

      {route === 'chat' ? (
        <ChatScreen provider={selectedProvider}
          loadingConversation={sessionLoading || remoteDrafts.opening}
          // The tablet keeps the session list on screen, so it has nothing to
          // pull out and the gutter stays free for the transcript.
          onEdgeSwipe={tabletMultiPane ? undefined : () => setSessionSwitcherOpen(true)}
          landing={!sessionId ? {
            provider: selectedProvider,
            harnessOptions,
            activeHarnessKey: suggestionHarnessKey(selectedProvider, selectedAcpAgentId),
            onHarness: selectHarness,
            activeProvider: harnessSelection.activeProvider,
            projectName: project?.name,
            onOpenProject: () => setScreen('project-picker'),
            worktreeSelection,
            worktreeInfo,
            branch: gitInfo?.branch,
            dirtyFiles: gitInfo?.dirty?.files,
            onWorktree: () => { setWorktreeDraft(worktreeSelection); setScreen('worktree'); void loadShellDetails(selectedProvider, project, false, true) },
            onBranch: openGitPage,
          } : undefined}
          selection={{ model: selectedModel, models, providerName: harnessSelection.activeProviderName,
            activeProvider: harnessSelection.activeProvider, onRefresh: refreshModels,
            effort: selectedEffort, efforts, acpAgentId: selectedAcpAgentId,
            agents: harnessSelection.agents, agent: harnessSelection.selectedAgentId,
            onAgent: harnessSelection.selectAgent,
            modes: harnessSelection.modes, mode: harnessSelection.selectedModeId,
            modeLabel: harnessSelection.modeLabel, modesLocked: harnessSelection.modesLocked,
            onMode: selectSessionMode,
            optionParams: harnessSelection.optionParams, onOptionParam: harnessSelection.setOptionParam,
            providers: harnessSelection.providers, providerId: harnessSelection.selectedProviderId,
            onProvider: selectSessionProvider,
            onModel: selectSessionModel, onEffort: selectSessionEffort }}
          webRef={webRef}
          permissionModes={permModes}
          permissionMode={permMode}
          sandboxInfo={composerSandboxInfo}
          sandboxSupport={harnessSelection.sandboxSupport}
          contextTokens={usage.contextTokens}
          contextWindow={ringContextWindow}
          totalCostUsd={usage.totalCostUsd}
          usage={composerUsage}
          slashHits={slashHits}
          slashCatalogStatus={suggestions.slashCatalogStatus}
          promptSuggestions={promptSuggestions}
          // `writeCommandLine` rather than a whole-draft overwrite: it is the one
          // path that also drives the native editor, and it leaves anything the
          // user typed on a later line — mention chips included — in place.
          onPromptSuggestion={(suggestion) => writeCommandLine(suggestion)}
          mentionRows={mentionRows}
          attachments={attachments}
          // A launch-time readout, as on desktop and in the Flutter app: the
          // folder chip answers for a session being configured. Both scopes
          // travel — showing only the project's is what made a session folder
          // added here look like it had not been written.
          projectDirs={sessionId ? [] : workspaceDirs}
          sessionDirs={sessionId ? [] : additionalDirs.sessionDirs}
          onManageDirectories={openAdditionalDirs}
          queuedMessages={queuedMessages}
          canSteer={canSteerQueued(selectedProvider)}
          canSteerSoon={canSteerQueuedSoon(selectedProvider)}
          onEditQueued={(messageId) => {
            const runtime = runtimeRef.current
            const message = runtime?.session.queuedMessages.find((item) => item.id === messageId)
            if (!runtime || !message) return
            runtime.dequeueMessage(messageId)
            const text = queuedMessageText(message)
            composerDraft.changeText(text)
            suggestions.update(text)
            if (message.attachments?.length) setAttachments(message.attachments)
          }}
          onSteerQueued={(messageId) => runUiAction(() => runtimeRef.current?.steerQueuedMessage(messageId, 'now'), setStatus, 'steer failed')}
          onSteerQueuedSoon={(messageId) => runUiAction(() => runtimeRef.current?.steerQueuedMessage(messageId, 'next'), setStatus, 'steer failed')}
          todos={todos}
          collapsedPrompts={collapsedPendingPrompts({ permission: collabRequestOf(perm) ? null : perm, plan, question }, promptCollapse.collapsed)}
          onExpandPrompt={promptCollapse.expand}
          draft={draft}
          streaming={streaming}
          onWebMessage={handleChatViewMessage}
          onWebProcessError={recoverChatView}
          onPermissionMode={(mode) => runUiAction(() => {
            runtimeRef.current?.setPermissionMode(mode)
            setPermMode(mode)
          }, setStatus, 'permission mode failed')}
          onSandboxMode={(mode) => runUiAction(
            () => {
              setPendingSandboxMode(mode)
              return runtimeRef.current?.setSandboxMode(mode)
            },
            setStatus,
            'sandbox mode failed',
          )}
          nativeDraft={{ controller: composerDraft.editorRef, document: composerDraft.document.current, generation: composerDraft.generation, onError: setStatus,
            onChange: (snapshot) => { composerDraft.accept(snapshot); suggestions.updateNative(snapshot.text, snapshot, snapshot.composing) } }}
          onSlash={(command) => {
            // `/mcp` and `/workflows` report rather than run: they open a panel
            // and take their own command line back out of the draft, the way the
            // desktop's `clearFirstLine` does. Leaving `/mcp` in the draft would
            // both offer to send it and keep the command list matching it.
            if (command === 'mcp') { writeCommandLine(''); openMcp(); return }
            if (command === 'add-dir' && harnessSupportsAdditionalDirs(selectedProvider)) {
              writeCommandLine('')
              openAdditionalDirs()
              return
            }
            if (command === 'workflows' && (selectedProvider === 'claude' || selectedProvider === 'acp')) {
              writeCommandLine('')
              openWorkflows()
              return
            }
            if (command === 'recap' && shouldInterceptGrokRecap(selectedProvider, selectedAcpAgentId)) {
              writeCommandLine('')
              const runtime = runtimeRef.current
              if (!runtime?.sessionId) return
              void runUiAction(() => runtime.requestRecap(), setStatus, 'recap failed')
              return
            }
            // Everything else is written into the draft for the agent to run.
            writeCommandLine(`/${command} `)
          }}
          onSlashDismiss={suggestions.dismissSlash}
          onMention={(item) => {
            if (composerDraft.editorRef.current) { composerDraft.editorRef.current.insertMention(item); return }
            const value = suggestions.insert(item)
            if (value === undefined) return
            // The plain editor cannot hold an identity, so the draft records
            // what this insertion wrote and rebuilds the tag at send time.
            const token = item.navigateTo === undefined ? mentionTokenFromItem(item) : undefined
            if (token) composerDraft.recordMention(mentionInsertText(item), token)
            composerDraft.changeText(value)
          }}
          onRemoveAttachment={(attachment) => setAttachments((current) => current.filter((item) => item !== attachment))}
          onAttachmentMenu={() => showAttachmentMenu({
            image: () => void addAttachment('image'),
            pdf: () => void addAttachment('pdf'),
          })}
          onAttachImage={() => void addAttachment('image')}
          onAttachPdf={() => void addAttachment('pdf')}
          onInsertSnippet={(snippet) => {
            if (composerDraft.editorRef.current) {
              composerDraft.editorRef.current.insertText(suggestions.snippetAtCursor(snippet))
              return
            }
            composerDraft.changeText(suggestions.insertSnippet(snippet))
          }}
          onDraft={onDraft}
          onCursorChange={suggestions.select}
          requestedCursor={suggestions.requestedCursor}
          mentionSearch={suggestions.mentionSearch}
          onMentionRetry={suggestions.retry}
          onMentionLoadMore={suggestions.loadMore}
          mentionQuery={suggestions.mentionQuery}
          mentionGroupLabels={suggestions.mentionGroupLabels}
          overlay={composerOverlay}
          onSubmitFromKeyboard={() => {
            const hasContent = draftRef.current.trim().length > 0 || attachments.length > 0
            if (shouldSubmitFromKeyboard({
              hasContent,
              lastTextChangeAt: lastDraftChangeAtRef.current,
              now: Date.now(),
            })) void send()
          }}
          onSend={() => { pendingSendKind.current = 'send'; void send() }}
          onSteer={() => { pendingSendKind.current = 'steer'; void send() }}
          onSteerSoon={() => { pendingSendKind.current = 'soon'; void send() }}
          onStop={() => runUiAction(() => runtimeRef.current?.interrupt(), setStatus, 'interrupt failed')}
        />
      ) : null}

      {route === 'session-search' ? (
        <SessionSearchScreen
          client={clientRef.current}
          onCancel={leaveToWorkspace}
          onOpenSession={(row) => runUiAction(async () => {
            const target = projects.find((item) => item.path === row.projectPath)
              ?? (row.projectPath ? { path: row.projectPath, name: row.projectName ?? row.projectPath } : project)
            if (!target) throw new Error('no project for this session')
            if (target.path !== project?.path) await openProject(target)
            await openSession(row, target)
          }, setStatus, 'failed to open session')}
        />
      ) : null}

      {route === 'project-picker' ? (
        <ProjectPickerScreen projects={projects} activePath={project?.path} onSelect={chooseProject} />
      ) : null}

      {route === 'add-project' ? <AddProjectScreen flow={addProjectFlow} /> : null}

      {route === 'worktree' ? (
        <WorktreeScreen
          selection={worktreeDraft}
          onSelectionChange={setWorktreeDraft}
          gitInfo={gitInfo}
          worktreeInfo={worktreeInfo}
          worktreeDirty={worktreeDirty}
          branches={branches}
          checkedOutBranches={checkedOutBranches}
        />
      ) : null}

      {route === 'branch' ? (
        <BranchScreen
          branches={branches}
          currentBranch={gitInfo?.branch}
          dirty={gitInfo?.dirty}
          onSwitch={(branch) => changeBranch(branch, 'switch_git_branch')}
          onCreate={(branch) => changeBranch(branch, 'create_git_branch')}
          onDone={() => setScreen('chat')}
        />
      ) : null}

      {route === 'collab-request' && collab.open ? (
        <CollabRequestScreen
          key={collab.open.requestId}
          payload={collab.open.payload}
          onApprove={(launches) => {
            const { requestId } = collab.open!
            collab.answered(requestId)
            runUiAction(
              () => runtimeRef.current?.respondPermission(requestId, true, { [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches) }),
              setStatus,
              'permission response failed',
            )
          }}
          onReject={(feedback) => {
            const { requestId } = collab.open!
            collab.answered(requestId)
            runUiAction(
              () => runtimeRef.current?.respondPermission(requestId, false, undefined, undefined, feedback),
              setStatus,
              'permission response failed',
            )
          }}
          onOpenTask={(launch) => { setCollabTask(launch); setScreen('collab-task') }}
        />
      ) : null}

      {route === 'collab-task' && collab.open && collabTask ? (
        <CollabTaskScreen
          key={`${collab.open.requestId}/${collabTask.launchId}`}
          load={collabTaskLoader}
        />
      ) : null}

      {route === 'add-dir' ? (
        <AddDirScreen
          step={additionalDirs.step}
          projectDirs={workspaceDirs}
          sessionDirs={additionalDirs.sessionDirs}
          entries={additionalDirs.entries}
          query={additionalDirs.query}
          loading={additionalDirs.loading}
          busy={additionalDirs.busy}
          error={additionalDirs.error}
          onQuery={additionalDirs.setQuery}
          onEnter={additionalDirs.enter}
          onBrowse={additionalDirs.browse}
          onRemove={(dir, scope) => void additionalDirs.remove(dir, scope)}
        />
      ) : null}

      {route === 'terminal' ? (
        <ConnectedTerminal webRef={termRef} runtimeRef={termRuntimeRef} theme={webViewTheme}
          writable={terminalUi.writable} onStatus={setStatus} />
      ) : null}
              </View>
              </View>
            )}
            />
            </View>
          </View>
        </View>
      </MobileKeyboardFrame>
      <MobileOverlays
        runtimeRef={runtimeRef}
        setStatus={setStatus}
        permission={collabRequestOf(perm) ? null : perm}
        plan={plan}
        question={question}
        planContinueMode={selectedProvider === 'claude'
          ? (permModes.includes('auto') ? 'auto' : 'acceptEdits')
          : undefined}
        onPlanContinueMode={setPermMode}
        collapsedPrompts={promptCollapse.collapsed}
        onCollapsePrompt={promptCollapse.collapse}
        workspace={{ ...workspaceList,
          visible: sessionSwitcherOpen,
          onDismiss: () => setSessionSwitcherOpen(false),
          deviceName,
          deviceStatus,
          reconnect,
          onDisconnect: disconnectDevice,
          onOpenAppSettings: openSettings,
        }}
        filePreview={filePreview}
        mediaPorts={mediaPorts}
      />
      {folderPrompt ? <NewFolderSheet
        parent={directoryPath}
        value={folderPrompt.value}
        error={folderPrompt.error}
        onChange={(value) => setFolderPrompt({ value, error: undefined })}
        onSubmit={() => createFolder(folderPrompt.value.trim())}
        onDismiss={() => setFolderPrompt(null)}
      /> : null}
    </SafeAreaView>
    </SessionActivityContext.Provider>
  )
}
