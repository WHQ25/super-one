import { refreshSessionCatalog } from '../session-catalog-refresh'
import { useComposerSend } from './use-composer-send'
import { TranscriptProjection } from '../transcript-projection'
import { SessionActivityContext, useWorkspaceActivity } from './use-session-activity'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { BackHandler, Linking, Pressable, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { HostOutbound } from '@superone/chat-view'
import {
  loadPairings, parsePairQr, RelayClient, savePairings, startPairingHandshake, upsertPairing,
  type SavedPairing,
} from '@superone/relay-client'
import type {
  AskUserQuestionRequest, ChatMessage, HarnessId, ImageAttachment, PermissionRequest,
  ListHarnessOptionsResponse, PlanApprovalRequest, RemoteCommand, RemoteHarnessOption,
  RealtimeTimelineSegment, SandboxInfo, SandboxMode, TodoItem, WorktreeInfo,
} from '@superone/shared/agent-types'
import { resolveRingContextWindow } from '@superone/shared/agent-types'
import { selectedCatalogContextWindow } from '@superone/shared/model-option-params'
import { mergeRealtimeTranscript } from '@superone/shared/realtime-transcript'
import { ChatRuntime, type SessionWorktreeFacts } from '../runtime'
import { TerminalRuntime } from '../terminal-runtime'
import { randomId } from '../ids'
import { mentionInsertText } from '../mentions'
import { SlashOutputPanel } from '../ui/slash-output-panel'
import { McpPanel } from '../ui/mcp-panel'
import { AddDirScreen } from '../screens/add-dir-screen'
import { WorkflowsPanel } from '../ui/workflows-panel'
import { workflowRunRows } from '../workflow-runs'
import { requestMcpServers, type McpServerRow } from '../mcp-status'
import { mentionTokenFromItem } from '../mention-selection'
import { isPairingQrInput, normalizePairingInput } from '../pairing-input'
import { usePairingDeepLink } from '../pairing-deep-link'
import { shouldSubmitFromKeyboard } from '../composer-state'
import { replaceFirstLine } from '../composer-first-line'
import { CHAT_VIEW_STATE_KEY, parseStoredChatViewStates, restoredChatWindow, type ChatViewState } from '../chat-view-state'
import { useComposerDraft } from './use-composer-draft'
import { useComposerSuggestions } from './use-composer-suggestions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { harnessSupportsAdditionalDirs } from '../provider-state'
import { isManualRecapCommand, shouldInterceptGrokRecap } from '../recap-command'
import { useAutoRecap } from './use-auto-recap'
import { harnessSupportsSandbox, sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import { suggestionHarnessKey } from '@superone/shared/suggestion-harness-order'
import { fileBrowserHome, joinRemotePath, parentRemotePath, resolveRemoteFilePath, type FileBrowserMode } from '../shell-state'
import { loadOrCreateMobileId, mobileKv } from '../storage'
import { registerFatalChatViewError } from '../chat-view-recovery'
import { pickAndUploadProjectFile, pickChatImages, pickChatPdf, showAttachmentMenu } from '../attachments'
import { AppSettingsScreen } from '../screens/app-settings-screen'
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
import { injectHostMessage as inject, resolveNativeRequest } from '../native-actions'
import { createMediaPorts } from '../media-ports'
import type { ReconnectController } from '../reconnect-controller'
import { createMobileRelayConnection } from '../mobile-relay-connection'
import { SessionTransition } from '../session-transition'
import { readProjectSessions } from './workspace-data'
import { useRemoteDirectory } from './use-remote-directory'
import { useProjectGitStatus } from './use-project-git-status'
import { useFileSearch } from './use-file-search'
import { completeTypedPath, usePathAutocomplete } from './use-path-autocomplete'
import { useAdditionalDirs } from './use-additional-dirs'
import { useFilePreview } from './use-file-preview'
import { loadInlineImage } from '../inline-images'
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
import { refreshHarnessResources, peekHarnessResource, preloadHarnessResources, requestHarnessResource } from '../harness-resource-cache'
import { useReconnectOnForeground } from '../use-reconnect-on-foreground'
import { useDeviceDiscovery } from './use-device-discovery'
import { isFullBleedScreen } from '../layout-state'
import { isReachable, type ReconnectInfo } from '../device-status'
import { logRelayEventTypes } from '../relay-debug'
import { dynamicMentionArtworkRevision, dynamicMentionArtworkSnapshot } from '../ui/mention-dynamic-artwork'
import { useMobileLocale } from '../i18n/context'
import { useOrientationLock } from './use-orientation-lock'
const kv = mobileKv
export function MobileApp() {
  useOrientationLock()
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
  const [gitInfo, setGitInfo] = useState<ShellGitInfo | null>(null)
  // Empty until the host answers; the switcher hides itself below two rows.
  const [harnessOptions, setHarnessOptions] = useState<RemoteHarnessOption[]>([])
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [worktreeDirty, setWorktreeDirty] = useState<Record<string, number>>({})
  const [branches, setBranches] = useState<string[]>([])
  const [checkedOutBranches, setCheckedOutBranches] = useState<string[]>([])
  const [worktreeSelection, setWorktreeSelection] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  // The worktree page edits a draft so that going back discards it; only the
  // header's confirm writes it through.
  const [worktreeDraft, setWorktreeDraft] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([])
  const composerDraft = useComposerDraft()
  const { draft, draftRef, lastDraftChangeAtRef } = composerDraft
  const [terminalUi, setTerminalUi] = useState({ writable: false, title: 'Terminal' })
  const [streaming, setStreaming] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'offline'>('offline')
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  /**
   * Bumped whenever the host reports a session-list change, and once after a
   * reconnect — events that landed while the socket was down were never
   * delivered, so everything cached is suspect. The drawer re-reads on a bump
   * instead of on every open.
   *
   * One counter rather than one per project: `useProjectSessions` only ever
   * caches the project it currently has open, so a change elsewhere costs at
   * most one extra request the next time the drawer is opened.
   */
  const [sessionListRevision, setSessionListRevision] = useState(0)
  /** Where a session goes when it ends, fails or is removed: the workspace, open. */
  const returnToWorkspace = () => { setScreen('chat'); setSessionSwitcherOpen(true) }
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
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
  const filePreview = useFilePreview({ clientRef, transport: activeTransport, project, sessionId })
  const workspaceActivity = useWorkspaceActivity(clientRef.current, connectionState === 'connected', sessionListRevision, screen === 'chat' && !sessionSwitcherOpen ? sessionId : null)
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
  const reconnectControllerRef = useRef<ReconnectController | null>(null)
  const connectionRef = useRef<{ state: 'connected' | 'reconnecting'; epoch: number }>({ state: 'connected', epoch: 0 })
  const sessionTransitionRef = useRef(new SessionTransition())
  const chatViewStatesRef = useRef<Record<string, ChatViewState>>({})
  const viewStateWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fatalReloadRef = useRef({ startedAt: 0, count: 0 })
  const mentionArtworkRevisionRef = useRef(-1)
  const suggestions = useComposerSuggestions(runtimeRef, `${activePairingId}:${project?.path}:${sessionId}:${selectedProvider}:${selectedAcpAgentId ?? ''}`, { client: clientRef, projectPath: project?.path, provider: selectedProvider, acpAgentId: selectedAcpAgentId, projects, iconStore: mobileKv })
  const { slashHits, mentionRows } = suggestions
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
  useReconnectOnForeground(() => reconnectControllerRef.current?.force(connectionRef.current.epoch))
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
  // Voice is woven in only on the way to the WebView. `session.messages` stays the
  // host's own list: the projected voice rows carry synthetic `codex-realtime-*` ids
  // that nothing on the host can resolve, and they would leak into `workflowRunRows`
  // and the in-progress dedupe in `ChatRuntime.open`.
  const transcriptCache = useRef<{
    messages: ChatMessage[]
    segments: RealtimeTimelineSegment[]
    merged: ChatMessage[]
  } | null>(null)
  const transcriptFor = (session: ChatRuntime['session']): ChatMessage[] => {
    const cached = transcriptCache.current
    if (cached && cached.messages === session.messages && cached.segments === session.realtimeSegments) {
      return cached.merged
    }
    const merged = mergeRealtimeTranscript(session.messages, session.realtimeSegments)
    transcriptCache.current = { messages: session.messages, segments: session.realtimeSegments, merged }
    return merged
  }
  const transcriptProjectionRef = useRef<{ runtime: ChatRuntime; projection: TranscriptProjection } | null>(null)
  const syncSheets = (runtime: ChatRuntime, hydrate = false) => {
    if (connectionRef.current.epoch !== runtime.epoch) {
      connectionRef.current = { state: 'connected', epoch: runtime.epoch }
      setConnectionState('connected')
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
    }
    if (transcriptProjectionRef.current?.runtime !== runtime) {
      transcriptProjectionRef.current = { runtime, projection: new TranscriptProjection() }
    }
    const pending = runtime.session.pendingPermissions[0]
    const mentionArtworkRevision = dynamicMentionArtworkRevision()
    const includeMentionArtwork = hydrate || mentionArtworkRevision !== mentionArtworkRevisionRef.current
    const mentionArtwork = includeMentionArtwork ? dynamicMentionArtworkSnapshot() : undefined
    inject(webRef, {
      type: hydrate ? 'hydrate' : 'applyReductionPatch',
      ...transcriptProjectionRef.current.projection.project(transcriptFor(runtime.session), hydrate),
      hasMoreHistory: runtime.hasMoreHistory,
      historyNavigation: runtime.navigationAvailable,
      ...(mentionArtwork ? { mentionArtwork } : {}),
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
      projectPath: runtime.projectPath || null,
    })
    if (includeMentionArtwork) mentionArtworkRevisionRef.current = mentionArtworkRevision
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
      previewFile: (path, line) => filePreview.open(path, line),
      previewImage: async (target) => { filePreview.showImage(target) },
      loadImage: async (path, confirmed) => {
        const client = clientRef.current
        if (!client || !project) throw new Error('no active project')
        return loadInlineImage({ host: client, transport: activeTransport, projectPath: project.path, sessionId, path, confirmed })
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
  const connectWithSecret = async (relayUrl: string, secret: string, lanHostPort?: string, hostName?: string, desktopDeviceId?: string) => {
    const activeDeviceId = deviceId || await loadOrCreateMobileId()
    if (!deviceId) setDeviceId(activeDeviceId)
    reconnectControllerRef.current?.cancel()
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    suppressReconnectRef.current = true
    clientRef.current?.disconnect()
    suppressReconnectRef.current = false
    const { client, reconnectController } = createMobileRelayConnection({
      onEvents: (events, epoch) => {
        logRelayEventTypes(events)
        workspaceActivity.ingest(events)
        const removed = sessionRemovalStatus(events, runtimeRef.current, epoch)
        if (removed) {
          clearActiveSession()
          returnToWorkspace()
          setStatus(removed === 'Desktop disconnected this session' ? '' : removed)
          return
        }
        // Read off the raw batch, before ChatRuntime: the drawer has to stay
        // current even when no session is open and there is no runtime to ingest.
        if (sessionListInvalidations(events).length) setSessionListRevision((n) => n + 1)
        additionalDirsRef.current.ingest(events)
        runtimeRef.current?.ingest(events, epoch)
      },
      onTerminal: (payload) => termRuntimeRef.current?.ingest(payload),
      restore: async (activeClient) => {
        await refreshHarnessResources(activeClient)
        const runtime = runtimeRef.current
        if (!runtime) return activeClient.releaseBuffer().epoch
        await runtime.reopen()
        termRuntimeRef.current?.recover()
        return runtime.epoch
      },
      currentEpoch: (activeClient) => runtimeRef.current?.epoch ?? activeClient.buffer.epoch,
      onConnection: (state, epoch) => {
        // A socket that was down missed every invalidation sent meanwhile.
        if (state === 'connected' && connectionRef.current?.state !== 'connected') {
          setSessionListRevision((n) => n + 1)
        }
        connectionRef.current = { state, epoch }
        setConnectionState(state)
        inject(webRef, { type: 'setConnection', state, epoch })
        // Connection feedback has one structured home in the header/sidebar.
        // Clear unrelated transient copy instead of painting a second status row.
        setStatus('')
      },
      onStatus: () => { /* DeviceStatus + reconnect own connection feedback. */ },
      onReconnectInfo: setReconnect,
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
    reconnectControllerRef.current = reconnectController
    clientRef.current = client
    const hp = (lanHostPort ?? lan).trim()
    if (hp.includes(':')) {
      const [host, port] = hp.split(':')
      await client.connectLan(host, Number(port), secret, { deviceId: activeDeviceId, deviceName: 'Expo' })
    } else {
      await client.connectRelay({ relayUrl, masterSecret: secret, deviceId: activeDeviceId, deviceName: 'Expo' })
    }
    setActiveTransport(client.transport)
    await rememberPairing({
      id: desktopDeviceId || hostName || relayUrl,
      relayUrl,
      secret,
      hostName,
      lan: hp.includes(':') ? hp : undefined,
      desktopDeviceId,
    })
    setActivePairingId(desktopDeviceId || hostName || relayUrl)
    const res = await client.request({ type: 'list_projects', requestId: randomId() } as RemoteCommand) as {
      projects?: Project[]
      error?: string
    }
    if (res.error) throw new Error(res.error)
    const projectRows = res.projects ?? []
    setProjects(projectRows)
    // Which harnesses this host offers, already ordered and labelled the way its
    // own new-session surface shows them.
    const options = await client.request({ type: 'list_harness_options', requestId: randomId() } as RemoteCommand)
      .then((result) => {
        const response = result as ListHarnessOptionsResponse | null
        return response && !('error' in response) ? response.options : []
      }).catch(() => [])
    if (clientRef.current !== client) return
    setHarnessOptions(options)
    if (projectRows[0]) await preloadHarnessResources(client, projectRows[0].path,
      [selectedProvider, ...options.map((option) => option.provider)])
    if (clientRef.current !== client) return
    if (projectRows[0]) { await openProject(projectRows[0]); startNewSession(projectRows[0]) }
    // Nothing to run a session in yet — land on the picker, which owns Add Project.
    else setScreen('project-picker')
    setStatus('')
    void Promise.all(projectRows.map(async (row) => {
      const git = await client.request({
        type: 'get_git_info',
        requestId: randomId(),
        projectPath: row.path,
      } as RemoteCommand) as ShellGitInfo
      return { ...row, git }
    })).then((rows) => {
      if (clientRef.current === client) setProjects(rows)
    }).catch(() => { /* Git indicators are best-effort. */ })
  }

  /**
   * Tapping a device it could not reach used to fail with a transport error.
   * Probe once first so an offline desktop is named as such, and prefer the
   * address discovery just found over the one stored at pairing time.
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
      const lanHostPort = discovered ? `${discovered.host}:${discovered.port}` : item.lan || lan
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
          deviceName: 'Expo',
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
  const openProject = async (p: Project) => {
    const client = clientRef.current
    if (!client) return
    systemInfoRequestRef.current++
    const projectRequest = ++shellDetailsRequestRef.current
    await preloadHarnessResources(client, p.path, [selectedProvider, ...harnessOptions.map((option) => option.provider)])
    if (clientRef.current !== client || projectRequest !== shellDetailsRequestRef.current) return
    setProject(p)
    setSessions((await readProjectSessions(client, p.path)).sessions)
    const git = await client.request({
      type: 'get_git_info',
      requestId: randomId(),
      projectPath: p.path,
    } as RemoteCommand).catch(() => null) as ShellGitInfo | null
    setGitInfo(git)
  }

  const loadShellDetails = async (provider: HarnessId = selectedProvider, p = project, refreshCatalog = false) => {
    const client = clientRef.current
    if (!client || !p) return
    const request = ++systemInfoRequestRef.current
    const shellRequest = ++shellDetailsRequestRef.current
    const details = await fetchShellDetails(client, p.path, provider, refreshCatalog)
    if (shellRequest !== shellDetailsRequestRef.current || clientRef.current !== client) return
    setGitInfo(details.git)
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

  // A live session applies picks immediately, the way the desktop selector does;
  // a draft keeps them locally until create_session carries them.
  const selectSessionModel = (model: string) => {
    harnessSelection.selectModel(model)
    runtimeRef.current?.setSessionSettings({ model })
  }

  const selectSessionEffort = (effort: string) => {
    setSelectedEffort(effort)
    runtimeRef.current?.setSessionSettings({ effort })
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
      onDetail: (event) => { if (runtimeRef.current === runtime) inject(webRef, { ...event, type: 'detailUpdate' }) },
      onSessionRecap: (sid) => autoRecap.markRecapShown(sid),
    })
    runtimeRef.current = runtime
    setTerminalUi({ writable: false, title: 'Terminal' })
    const term = new TerminalRuntime(client, (paints) => {
      for (const p of paints) inject(termRef, p)
      setTerminalUi((current) => (
        current.writable === term.writable && current.title === term.title
          ? current
          : { writable: term.writable, title: term.title }
      ))
    })
    termRuntimeRef.current = term
    return runtime
  }

  const refreshRuntimeCatalog = (runtime: ChatRuntime, provider: HarnessId, restoreSelection = false) => {
    const request = ++systemInfoRequestRef.current
    refreshSessionCatalog(() => runtime.loadSystemInfo(provider),
      () => request === systemInfoRequestRef.current && runtimeRef.current === runtime,
      (info) => applySystemInfo(provider, info, restoreSelection ? {
        model: provider === 'codex' ? runtime.session.selectedCodexModel : runtime.session.selectedModel,
        effort: provider === 'codex' ? runtime.session.selectedCodexReasoningEffort : runtime.session.selectedEffort,
        permissionMode: runtime.permissionMode,
      } : undefined),
      (error) => setStatus(error instanceof Error ? error.message : 'Could not load agent settings'))
  }
  const resetSessionChrome = () => {
    systemInfoRequestRef.current++
    setSessionWorktree({ isWorktree: false, worktreePath: null, gitBranch: null, removed: false })
    setPerm(null)
    setPlan(null)
    setQuestion(null)
    setStreaming(false)
    setHasTranscript(false)
    setTodos({})
    setPromptSuggestions([])
    setQueuedMessages([])
    setSlashOutput(null)
    setSandboxInfo(null)
    setPendingSandboxMode(null)
    setUsage({ contextTokens: 0, contextWindow: null, totalCostUsd: 0 })
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
    clearActiveSession()
    returnToWorkspace()
    setStatus(error instanceof Error ? error.message : 'session transition failed')
  }
  const openSession = (row: SessionRow, targetProject = project) => sessionTransitionRef.current.run(async () => {
    const client = clientRef.current
    const p = targetProject
    if (!client || !p) return
    if (runtimeRef.current?.sessionId === row.sessionId && runtimeRef.current.projectPath === p.path) {
      setScreen('chat')
      return
    }
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

  const startNewSession = (targetProject = project) => {
    leaveActiveSession()
    setStatus('')
    setActiveSessionTitle('New session')
    setScreen('chat')
    // Configuring a session is the one moment the host's configured defaults are
    // read, so this is where the catalog cache is worth paying to bypass.
    runUiAction(() => loadShellDetails(selectedProvider, targetProject, true), setStatus, 'failed to load project settings')
  }
  /** Open a project for a new session — the picker's only exit that keeps state. */
  const chooseProject = (target: Project) =>
    runUiAction(async () => { await openProject(target); startNewSession(target) },
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
    setScreen('chat')
    if (!shouldUseTabletMultiPane(width, height, 'chat', !!project)) setSessionSwitcherOpen(true)
  }

  /** Checkout or create a branch on the paired desktop, then re-read git state. */
  const changeBranch = async (branch: string, type: 'switch_git_branch' | 'create_git_branch') => {
    const client = clientRef.current
    if (!client || !project) throw new Error('Connect to a desktop to change branches')
    const result = await client.request({
      type, requestId: randomId(), projectPath: project.path, branch,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (result?.ok === false) throw new Error(result.error || 'Could not change branch')
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
  const createSession = async () => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const selectionError = selectedProvider === 'claude'
      ? worktreeSelectionError(worktreeSelection, branches, checkedOutBranches)
      : null
    if (selectionError) {
      setStatus(selectionError)
      return
    }
    return sessionTransitionRef.current.run(async () => {
      const previousId = runtimeRef.current?.sessionId
      if (previousId) client.send({ type: 'leave_session', sessionId: previousId })
      const runtime = bindRuntime(client)
      const startupDirs = [...new Set([...workspaceDirs, ...additionalDirs.sessionDirs])]
      const id = randomId()
      // Leave the landing immediately — the first send should look like desktop,
      // not a "Starting session…" wait. Host errors still land on the status line.
      setSessionId(id)
      setActiveSessionTitle('New session')
      setScreen('chat')
      await runtime.create(p.path, {
        sessionId: id,
        provider: selectedProvider,
        ...(selectedProvider === 'acp' && selectedAcpAgentId
          ? { acpAgentId: selectedAcpAgentId }
          : {}),
        permissionMode: permMode,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        ...(selectedProvider === 'claude'
          ? buildWorktreeCreateOptions(worktreeSelection, gitInfo?.branch)
          : {}),
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

  const send = useComposerSend(composerDraft.editorRef, `${activePairingId}:${project?.path}:${sessionId}`, async () => {
    const sentDraft = composerDraft.capture()
    const text = sentDraft.text.trim()
    if (!text && attachments.length === 0) return
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
    if (!runtimeRef.current) await createSession()
    const runtime = runtimeRef.current
    if (!runtime) return
    try {
      await runtime.send(text, {
        images: attachments,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        ...(selectedProvider === 'opencode' && harnessSelection.selectedAgentId
          ? { agent: harnessSelection.selectedAgentId }
          : {}),
        ...(harnessSelection.serviceTier ? { serviceTier: harnessSelection.serviceTier } : {}),
        ...(Object.keys(harnessSelection.modelParams).length
          ? { modelParams: harnessSelection.modelParams }
          : {}),
      })
      if (!sessionId && !runtime.sessionTitle && text) setActiveSessionTitle(sentDraft.title.slice(0, 72))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'message failed')
      return
    }
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
  const disconnectDevice = () => {
    reconnectControllerRef.current?.cancel()
    suppressReconnectRef.current = true
    clientRef.current?.disconnect()
    suppressReconnectRef.current = false
    clientRef.current = null
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    clearActiveSession()
    setActivePairingId(null)
    setActiveTransport(null)
    setReconnect(null)
    setConnectionState('offline')
    setScreen('pair')
  }

  const back = () => {
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

  const openTerminal = () => {
    const p = project
    const runtime = runtimeRef.current
    const term = termRuntimeRef.current
    if (!p || !term) return
    setScreen('terminal')
    if (!term.terminalId) runUiAction(() => term.create(p.path, runtime?.sessionId), setStatus, 'terminal failed')
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
  const header = screen === 'files'
    ? browserMode.name
    : mobileHeaderTitle(screen, project?.name, activeSessionTitle, terminalUi.title, t)
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
    listRevision: sessionListRevision,
    onNewSession: (p: Project) => runUiAction(async () => { await openProject(p); startNewSession(p) }, setStatus, 'failed to open project'),
    onOpenSession: (p: Project, row: SessionRow) => runUiAction(async () => { if (p.path !== project?.path) await openProject(p); await openSession(row, p) }, setStatus, 'failed to open session'),
    ...sessionListActions,
    onSearch: () => setScreen('session-search'),
    onAddProject: () => { setAddProjectOrigin('workspace'); setScreen('add-project') },
  }

  const tabletMultiPane = shouldUseTabletMultiPane(width, height, screen, !!project)

  // Android's back button is the hardware twin of the swipe the navigator no
  // longer accepts on chat, so it opens the workspace for the same reason.
  // While the drawer is up the dialog consumes back itself and this never runs.
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
        {/* Header lives in the detail column so the persistent sidebar can
            occupy the full window height. On a phone the column is the whole
            frame, so the bar still sits at the top. */}
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
        <MobileHeader
        pendingCount={workspaceActivity.pendingCount}
        route={screen}
        title={screen === 'add-project' ? addProjectFlow.title : header}
        subtitle={project?.name}
        provider={selectedProvider}
        hasSession={!!sessionId}
        sessionId={sessionId}
        deviceStatus={deviceStatus}
        reconnect={reconnect}
        sidebarVisible={tabletMultiPane}
        git={sessionGit}
        onOpenBranch={() => setScreen('branch')}
        onBack={back}
        onSwitchSession={() => setSessionSwitcherOpen(true)}
        onOpenTerminal={openTerminal}
        onOpenFiles={() => openFiles('session')}
        onOpenFilesRoot={() => runUiAction(() => loadDirectory(fileBrowserHome(browserMode, directoryPath)), setStatus, 'failed to load directory')}
        files={screen === 'files' ? { kind: browserKind, finderOpen,
          onToggleFinder: () => {
            if (finderOpen) { closeFinder(); return }
            if (browserKind === 'computer') setGotoPath(`${directoryPath.replace(/\/+$/, '')}/`)
            setFinderOpen(true)
          } } : undefined}
        onConfirm={screen === 'worktree'
          ? () => { setWorktreeSelection(worktreeDraft); setScreen('chat') }
          : screen === 'add-project' && addProjectFlow.confirmLabel
            ? addProjectFlow.confirm
            // Only while browsing: the overview has nothing to commit, it hands
            // off to the browser. Same slot Add Project commits from.
            : screen === 'add-dir' && additionalDirs.canGoBack
              ? () => runUiAction(additionalDirs.confirm, setStatus, 'could not add that folder')
              : undefined}
        confirmLabel={screen === 'add-project' ? addProjectFlow.confirmLabel ?? undefined
          : screen === 'add-dir' && additionalDirs.canGoBack ? 'Add' : undefined}
        onAddProject={screen === 'project-picker'
          ? () => { setAddProjectOrigin('picker'); setScreen('add-project') }
          : undefined}
        confirmDisabled={screen === 'add-project'
          ? addProjectFlow.busy
          // A folder the host has not confirmed exists cannot be added, so the
          // action stays off rather than failing after the tap.
          : screen === 'add-dir'
            ? additionalDirs.busy || !additionalDirs.resolvedPath
            : !!worktreeSelectionError(worktreeDraft, branches, checkedOutBranches)}
        />
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
              // Chat cannot be swiped off the stack (see MobileNavigator), so
              // reaching the device list means the transport is already gone —
              // but a stray pop must still not leave a session held open.
              if (screen === 'chat' && route === 'pair' && sessionId) leaveActiveSession()
              setScreen(route)
            }}
            renderScene={(route) => (
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
            await updatePairings((current) => current.filter((pairing) => pairing.id !== item.id))
            if (activePairingId === item.id) disconnectDevice()
          }, setStatus, 'failed to forget device')}
        />
      ) : null}

      {route === 'settings' ? (
        <AppSettingsScreen />
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
          onNewFolder={() => setFolderPrompt({ value: '' })}
          onUploadFile={() => void uploadProjectFile(directoryPath)}
          onOpenDirectory={(path) => runUiAction(() => loadDirectory(path), setStatus, 'failed to load directory')}
          onOpenFile={(path) => runUiAction(() => previewFile(path), setStatus, 'failed to open file')}
        />
      )) : null}

      {route === 'chat' ? (
        <ChatScreen provider={selectedProvider}
          loadingConversation={sessionLoading}
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
            onWorktree: () => { setWorktreeDraft(worktreeSelection); setScreen('worktree') },
            onBranch: () => setScreen('branch'),
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
          todos={todos}
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
            file: () => void uploadProjectFile(),
          })}
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
          onSend={() => void send()}
          onStop={() => runUiAction(() => runtimeRef.current?.interrupt(), setStatus, 'interrupt failed')}
        />
      ) : null}

      {route === 'session-search' ? (
        <SessionSearchScreen
          client={clientRef.current}
          onCancel={() => setScreen('chat')}
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
            )}
            />
            </View>
          </View>
        </View>
      </MobileKeyboardFrame>
      {status ? <Text style={styles.meta}>{status}</Text> : null}
      <MobileOverlays
        runtimeRef={runtimeRef}
        setStatus={setStatus}
        permission={perm}
        plan={plan}
        question={question}
        planContinueMode={selectedProvider === 'claude'
          ? (permModes.includes('auto') ? 'auto' : 'acceptEdits')
          : undefined}
        onPlanContinueMode={setPermMode}
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
