import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as Clipboard from 'expo-clipboard'
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { Linking, Pressable, useWindowDimensions, View } from 'react-native'
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
  PlanApprovalRequest, RemoteCommand, TodoItem, WorktreeInfo,
} from '@superone/shared/agent-types'
import { ChatRuntime } from '../runtime'
import { TerminalRuntime } from '../terminal-runtime'
import { randomId } from '../ids'
import { isPairingQrInput, normalizePairingInput } from '../pairing-input'
import { usePairingDeepLink } from '../pairing-deep-link'
import { shouldSubmitFromKeyboard } from '../composer-state'
import { CHAT_VIEW_STATE_KEY, parseStoredChatViewStates, restoredChatWindow, type ChatViewState } from '../chat-view-state'
import { useComposerDraft } from './use-composer-draft'
import { useComposerSuggestions } from './use-composer-suggestions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { harnessSupportsAdditionalDirs } from '../provider-state'
import { parentRemotePath, resolveRemoteFilePath } from '../shell-state'
import { loadOrCreateMobileId, mobileKv } from '../storage'
import { registerFatalChatViewError } from '../chat-view-recovery'
import { pickAndUploadProjectFile, pickChatImages, pickChatPdf, showAttachmentMenu } from '../attachments'
import { SettingsScreen, type ProjectSettingsProps, type ShellGitInfo } from '../screens/settings-screen'
import {
  buildWorktreeCreateOptions,
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from '../worktree-state'
import { shouldUseTabletMultiPane } from '../layout-state'
import { TabletSessionSidebar, type TabletSessionRow as SessionRow } from './tablet-session-sidebar'
import { injectHostMessage as inject, resolveNativeRequest } from '../native-actions'
import { useSharedFileInbox } from '../shared-file-inbox'
import type { ReconnectController } from '../reconnect-controller'
import { createMobileRelayConnection } from '../mobile-relay-connection'
import { SessionTransition } from '../session-transition'
import { readProjectSessions } from './workspace-data'
import { useRemoteDirectory } from './use-remote-directory'
import { leaveMobileSession, sessionRemovalStatus } from '../session-exit'
import { ProjectsScreen, type Project } from '../screens/projects-screen'
import { runUiAction } from '../ui-action'
import { FilesScreen } from '../screens/files-screen'
import { ChatScreen } from '../screens/chat-screen'
import { PairingsScreen } from '../screens/pairings-screen'
import { ConnectedTerminal } from './connected-terminal'
import { SessionsScreen } from '../screens/sessions-screen'
import { MobileNavigator, type MobileRoute as Screen } from './mobile-navigator'
import { MobileHeader, mobileHeaderTitle } from './mobile-header'
import { MobileOverlays } from './mobile-overlays'
import { MobileKeyboardFrame } from './mobile-keyboard-frame'
import { useHarnessSelection } from './use-harness-selection'
import { fetchShellDetails } from './shell-details'
import { useReconnectOnForeground } from '../use-reconnect-on-foreground'
import { useDeviceDiscovery } from './use-device-discovery'
import { isReachable, type ReconnectInfo } from '../device-status'
import { logRelayEventTypes } from '../relay-debug'
import { Sheet } from '../ui'
import { dynamicMentionArtworkRevision, dynamicMentionArtworkSnapshot } from '../ui/mention-dynamic-artwork'
const kv = mobileKv
export function MobileApp() {
  const styles = useMobileStyles()
  const { tokens, setHarness } = useMobileTheme()
  const webViewTheme = useMemo(() => mobileWebViewTheme(tokens), [tokens])
  const { width, fontScale } = useWindowDimensions()
  const [screen, setScreen] = useState<Screen>('pair')
  const [paste, setPaste] = useState('')
  const [lan, setLan] = useState('')
  const [status, setStatus] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [worktreeOpen, setWorktreeOpen] = useState(false)
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
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [checkedOutBranches, setCheckedOutBranches] = useState<string[]>([])
  const [worktreeSelection, setWorktreeSelection] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([])
  const [additionalDir, setAdditionalDir] = useState('')
  const composerDraft = useComposerDraft()
  const { draft, draftRef, lastDraftChangeAtRef } = composerDraft
  const [termDraft, setTermDraft] = useState('')
  const [terminalUi, setTerminalUi] = useState({ writable: false, title: 'Terminal' })
  const [streaming, setStreaming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'offline'>('offline')
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([])
  const [todos, setTodos] = useState<Record<string, TodoItem>>({})
  const [perm, setPerm] = useState<PermissionRequest | null>(null)
  const [plan, setPlan] = useState<PlanApprovalRequest | null>(null)
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null)
  const sharedFileInbox = useSharedFileInbox()
  const webRef = useRef<WebView>(null)
  const termRef = useRef<WebView>(null)
  const clientRef = useRef<RelayClient | null>(null)
  const directory = useRemoteDirectory(clientRef)
  const { load: loadDirectory, path: directoryPath, items: directoryItems } = directory
  const runtimeRef = useRef<ChatRuntime | null>(null)
  const termRuntimeRef = useRef<TerminalRuntime | null>(null)
  const reconnectControllerRef = useRef<ReconnectController | null>(null)
  const connectionRef = useRef<{ state: 'connected' | 'reconnecting'; epoch: number }>({ state: 'connected', epoch: 0 })
  const sessionTransitionRef = useRef(new SessionTransition())
  const chatViewStatesRef = useRef<Record<string, ChatViewState>>({})
  const viewStateWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fatalReloadRef = useRef({ startedAt: 0, count: 0 })
  const mentionArtworkRevisionRef = useRef(-1)
  const suggestions = useComposerSuggestions(runtimeRef, `${activePairingId}:${project?.path}:${sessionId}:${selectedProvider}`, { client: clientRef, projectPath: project?.path })
  const { slashHits, mentionHits } = suggestions
  const systemInfoRequestRef = useRef(0)
  const auxiliaryReturnRef = useRef<'sessions' | 'chat'>('sessions')
  const suppressReconnectRef = useRef(false)
  const scanningRef = useRef(false)
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
    inject(webRef, { type: 'setViewport', fontScale, locale: 'en' })
  }, [fontScale])
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
    inject(webRef, {
      type: hydrate ? 'hydrate' : 'applyReductionPatch',
      messages: runtime.session.messages,
      todos: runtime.session.todos,
      ...(mentionArtwork ? { mentionArtwork } : {}),
      pendingPermission: pending
        ? { requestId: pending.requestId, toolName: pending.toolName, toolUseId: pending.toolUseId }
        : null,
    })
    if (includeMentionArtwork) mentionArtworkRevisionRef.current = mentionArtworkRevision
    setStreaming(runtime.streaming)
    setQueuedMessages(runtime.session.queuedMessages)
    setTodos(runtime.session.todos)
    setPermMode(runtime.permissionMode)
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
      openLink: async (url) => { await Linking.openURL(url) },
      copyText: async (text) => { await Clipboard.setStringAsync(text) },
      codexPlanApproval: async (messageId, status, feedback) => {
        const runtime = runtimeRef.current
        if (!runtime) throw new Error('no active session')
        runtime.respondCodexPlan(messageId, status, feedback)
      },
      previewFile: async (path) => {
        const client = clientRef.current
        if (!client || !project) throw new Error('no active project')
        await sharedFileInbox.receiveDesktopFile(client, project.path, sessionId, path)
      },
      openFile: async (path) => {
        if (!project) throw new Error('no active project')
        const target = resolveRemoteFilePath(project.path, path)
        auxiliaryReturnRef.current = 'chat'
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
    if (message.type === 'ready' && runtimeRef.current) {
      inject(webRef, webViewTheme)
      inject(webRef, { type: 'setViewport', fontScale, locale: 'en' })
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
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
        const removed = sessionRemovalStatus(events, runtimeRef.current, epoch)
        if (removed) { clearActiveSession(); setScreen('sessions'); setStatus(removed); return }
        runtimeRef.current?.ingest(events, epoch)
      },
      onTerminal: (payload) => termRuntimeRef.current?.ingest(payload),
      restore: async (activeClient) => {
        const runtime = runtimeRef.current
        if (!runtime) return activeClient.releaseBuffer().epoch
        await runtime.reopen()
        termRuntimeRef.current?.recover()
        return runtime.epoch
      },
      currentEpoch: (activeClient) => runtimeRef.current?.epoch ?? activeClient.buffer.epoch,
      onConnection: (state, epoch) => {
        connectionRef.current = { state, epoch }
        setConnectionState(state)
        inject(webRef, { type: 'setConnection', state, epoch })
        setStatus(state === 'connected' ? '' : 'disconnected — reconnecting')
      },
      onStatus: setStatus,
      onReconnectInfo: setReconnect,
      onShutdown: () => {
        setConnectionState('offline')
        setStatus('desktop shut down')
        setScreen('pair')
      },
      onKicked: () => {
        setConnectionState('offline')
        setStatus('this device was removed from the desktop')
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
    if (projectRows[0]) { await openProject(projectRows[0]); startNewSession(projectRows[0]) }
    else setScreen('projects')
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
          setStatus('Desktop is unreachable. Make sure SuperOne is running on your computer.')
          return
        }
      }
      const discovered = discovery.lanAddressOf(item.id)
      const lanHostPort = discovered ? `${discovered.host}:${discovered.port}` : item.lan || lan
      await connectWithSecret(item.relayUrl, item.secret, lanHostPort, item.hostName, item.desktopDeviceId)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'connect failed')
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
        const { code: c, done } = startPairingHandshake({
          qr,
          mobileDeviceId: activeDeviceId,
          deviceName: 'Expo',
          openSocket: (url) => new WebSocket(url) as never,
        })
        setCode(c)
        setStatus('Confirm this code on the desktop')
        const paired = await done
        setCode(null)
        await connectWithSecret(paired.relayUrl || qr.relayUrl, paired.masterSecret, undefined, paired.hostName, qr.desktopDeviceId)
        return
      }
      const json = JSON.parse(raw) as { relayUrl?: string; secret?: string; url?: string }
      const url = json.relayUrl ?? json.url
      if (!url || !json.secret) throw new Error('JSON needs relayUrl and secret')
      await connectWithSecret(url, json.secret)
    } catch (e) {
      setCode(null)
      setStatus(e instanceof Error ? e.message : 'pair failed')
    }
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
    setProject(p)
    setSessions(await readProjectSessions(client, p.path))
    const git = await client.request({
      type: 'get_git_info',
      requestId: randomId(),
      projectPath: p.path,
    } as RemoteCommand).catch(() => null) as ShellGitInfo | null
    setGitInfo(git)
    setScreen('sessions')
  }

  const loadShellDetails = async (provider: HarnessId = selectedProvider, p = project) => {
    const client = clientRef.current
    if (!client || !p) return
    const request = ++systemInfoRequestRef.current
    const details = await fetchShellDetails(client, p.path, provider)
    if (request !== systemInfoRequestRef.current) return
    setGitInfo(details.git)
    setWorkspaceDirs(details.workspaceDirs)
    setWorktreeInfo(details.worktree)
    if (details.system) applySystemInfo(provider, details.system, provider === selectedProvider
      ? { model: selectedModel, effort: selectedEffort, permissionMode: permMode } : undefined)
    setBranches(details.branches)
    setCheckedOutBranches(details.checkedOutBranches)
  }

  const refreshModels = async () => {
    const client = clientRef.current
    if (!client || !project) throw new Error('Connect to a desktop to refresh models')
    const request = ++systemInfoRequestRef.current
    const info = await client.request({ type: 'get_system_info', requestId: randomId(), projectPath: project.path, provider: selectedProvider }) as import('@superone/shared/agent-types').RemoteSystemInfo
    if (request !== systemInfoRequestRef.current || clientRef.current !== client) return
    if (info.error) throw new Error(info.error)
    applySystemInfo(selectedProvider, info, { model: selectedModel, effort: selectedEffort, permissionMode: permMode })
  }

  const openSettings = () => {
    auxiliaryReturnRef.current = screen === 'chat' ? 'chat' : 'sessions'
    setScreen('settings')
    runUiAction(() => loadShellDetails(), setStatus, 'failed to load settings')
  }

  const openFiles = () => {
    const p = project
    if (!p) return
    setScreen('files')
    runUiAction(() => loadDirectory(p.path), setStatus, 'failed to load directory')
  }

  const previewFile = async (path: string) => {
    const client = clientRef.current
    if (!client || !project) throw new Error('no active project')
    setStatus(`Opening ${path.split('/').pop() ?? path}…`)
    await sharedFileInbox.receiveDesktopFile(client, project.path, sessionId, path)
  }

  const addWorkspaceDirectory = async () => {
    const client = clientRef.current
    const p = project
    const dir = additionalDir.trim()
    if (!client || !p || !dir) return
    const validation = await client.request({
      type: 'validate_add_dir',
      requestId: randomId(),
      projectPath: p.path,
      candidate: dir,
    } as RemoteCommand) as { ok?: boolean; reason?: string; error?: string }
    if (!validation.ok) {
      setStatus(validation.reason ?? validation.error ?? 'invalid directory')
      return
    }
    const result = await client.request({
      type: 'add_project_additional_dir',
      requestId: randomId(),
      projectPath: p.path,
      dir,
      provider: selectedProvider,
    } as RemoteCommand) as { ok?: boolean; reason?: string }
    if (!result.ok) {
      setStatus(result.reason ?? 'failed to add directory')
      return
    }
    setWorkspaceDirs((current) => current.includes(dir) ? current : [...current, dir])
    setAdditionalDir('')
  }

  const removeWorkspaceDirectory = async (dir: string) => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const result = await client.request({
      type: 'remove_project_additional_dir',
      requestId: randomId(),
      projectPath: p.path,
      dir,
      provider: selectedProvider,
    } as RemoteCommand) as { ok?: boolean; reason?: string }
    if (!result.ok) {
      setStatus(result.reason ?? 'failed to remove directory')
      return
    }
    setWorkspaceDirs((current) => current.filter((item) => item !== dir))
  }

  const bindRuntime = (client: RelayClient) => {
    setStatus('')
    runtimeRef.current?.dispose()
    const runtime = new ChatRuntime(client, () => {
      if (runtimeRef.current === runtime) syncSheets(runtime)
    }, { onSharedFile: (event) => void sharedFileInbox.receive(client, event) })
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

  const clearActiveSession = () => {
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    setSessionId(null)
    setActiveSessionTitle('')
    setPerm(null)
    setPlan(null)
    setQuestion(null)
    setStreaming(false)
    setTodos({})
    setQueuedMessages([])
  }
  const leaveActiveSession = () => {
    runUiAction(() => {
      try { leaveMobileSession(clientRef.current, runtimeRef) } finally { clearActiveSession() }
    }, setStatus, 'leave session failed')
  }
  const failSessionTransition = (error: unknown) => {
    clearActiveSession()
    setScreen('sessions')
    setStatus(error instanceof Error ? error.message : 'session transition failed')
  }
  const openSession = (row: SessionRow, targetProject = project) => sessionTransitionRef.current.run(async () => {
    const client = clientRef.current
    const p = targetProject
    if (!client || !p) return
    const previousId = runtimeRef.current?.sessionId
    if (previousId && previousId !== row.sessionId) client.send({ type: 'leave_session', sessionId: previousId })
    setSessionId(row.sessionId)
    setActiveSessionTitle(row.title || 'Untitled')
    const provider = (row.provider ?? 'claude') as HarnessId
    setSelectedProvider(provider)
    setHarness(provider)
    const runtime = bindRuntime(client)
    setScreen('chat')
    await runtime.open(p.path, row.sessionId)
    const info = await runtime.loadSystemInfo(provider)
    applySystemInfo(provider, info, {
      model: provider === 'codex'
        ? runtime.session.selectedCodexModel
        : runtime.session.selectedModel,
      effort: provider === 'codex'
        ? runtime.session.selectedCodexReasoningEffort
        : runtime.session.selectedEffort,
      permissionMode: runtime.permissionMode,
    })
  }).catch(failSessionTransition)

  const removeSession = async (row: SessionRow, type: 'archive_session' | 'delete_session') => {
    const client = clientRef.current
    const p = project
    if (!client || !p) throw new Error('no active project')
    const result = await client.request({
      type,
      requestId: randomId(),
      projectPath: p.path,
      sessionId: row.sessionId,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? `failed to ${type === 'archive_session' ? 'archive' : 'delete'} session`)

    setSessions((current) => current.filter((item) => item.sessionId !== row.sessionId))
    if (sessionId === row.sessionId) {
      leaveActiveSession()
      setScreen('sessions')
    }
  }

  const removeFromList = (row: SessionRow, type: 'archive_session' | 'delete_session') =>
    runUiAction(() => removeSession(row, type), setStatus, 'failed to remove session')

  const startNewSession = (targetProject = project) => {
    leaveActiveSession()
    setStatus('')
    setActiveSessionTitle('New session')
    setScreen('chat')
    runUiAction(() => loadShellDetails(selectedProvider, targetProject), setStatus, 'failed to load project settings')
  }
  const selectProvider = (provider: HarnessId) => {
    harnessSelection.resetForProvider(provider)
    setHarness(provider)
    if (provider !== 'claude') setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
    runUiAction(() => loadShellDetails(provider), setStatus, 'failed to load agent settings')
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
      const id = await runtime.create(p.path, {
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
        ...(harnessSupportsAdditionalDirs(selectedProvider) && workspaceDirs.length
          ? { additionalDirectories: workspaceDirs }
          : {}),
      })
      setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
      setSessionId(id)
      setActiveSessionTitle('New session')
      setScreen('chat')
      const info = await runtime.loadSystemInfo(selectedProvider)
      applySystemInfo(selectedProvider, info, {
        model: selectedModel,
        effort: selectedEffort,
        permissionMode: permMode,
      })
    }).catch(failSessionTransition)
  }

  const send = async () => {
    if (composerDraft.editorRef.current && !composerDraft.editorRef.current.canSubmit()) return
    const sentDraft = composerDraft.capture()
    const text = sentDraft.text.trim()
    if ((!text && attachments.length === 0) || sessionTransitionRef.current.isActive) return
    if (!runtimeRef.current) {
      setStarting(true)
      try { await createSession() } finally { setStarting(false) }
    }
    const runtime = runtimeRef.current
    if (!runtime) return
    try {
      await runtime.send(text, {
        images: attachments,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
      })
      if (!sessionId && !runtime.sessionTitle && text) setActiveSessionTitle(sentDraft.title.slice(0, 72))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'message failed')
      return
    }
    if (composerDraft.clearSent(sentDraft.revision) && !composerDraft.editorRef.current) suggestions.update('')
    setAttachments((current) => current.filter((item) => !attachments.includes(item)))
  }

  const onDraft = (text: string) => {
    composerDraft.changeText(text)
    suggestions.update(text)
  }

  const addAttachment = async (kind: 'image' | 'pdf') => {
    try {
      const picked = kind === 'image' ? await pickChatImages(8 - attachments.length) : [await pickChatPdf()].filter(Boolean) as ImageAttachment[]
      setAttachments((current) => [...current, ...picked].slice(0, 8))
    } catch (error) { setStatus(error instanceof Error ? error.message : 'attachment failed') }
  }

  const uploadProjectFile = async () => {
    if (!project || !clientRef.current) return
    setStatus('Uploading file…')
    try {
      const saved = await pickAndUploadProjectFile({ client: clientRef.current, projectPath: project.path, sessionId: sessionId ?? undefined })
      setStatus(saved ? `Uploaded to ${saved}` : 'Upload cancelled')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'upload failed') }
  }

  const back = () => {
    if (screen === 'files') {
      setScreen('settings')
      return
    }
    if (screen === 'settings') {
      setScreen(auxiliaryReturnRef.current)
      return
    }
    if (screen === 'terminal') {
      setScreen('chat')
      return
    }
    if (screen === 'chat') {
      leaveActiveSession()
      setScreen('sessions')
      return
    }
    if (screen === 'sessions') setScreen('projects')
    if (screen === 'projects') setScreen('pair')
  }

  const openTerminal = () => {
    const p = project
    const runtime = runtimeRef.current
    const term = termRuntimeRef.current
    if (!p || !term) return
    setScreen('terminal')
    if (!term.terminalId) runUiAction(() => term.create(p.path, runtime?.sessionId), setStatus, 'terminal failed')
  }

  const settingsProps: ProjectSettingsProps = {
    activeSession: !!sessionId,
    gitInfo, worktreeInfo, branches, checkedOutBranches, worktreeSelection,
    onWorktreeSelectionChange: setWorktreeSelection,
    selectedProvider, selectedModel, selectedEffort, models, efforts, workspaceDirs, additionalDir,
    onAdditionalDirChange: setAdditionalDir, onProviderChange: selectProvider,
    onModelChange: harnessSelection.selectModel, onEffortChange: setSelectedEffort,
    onOpenFiles: openFiles,
    onAddDirectory: () => runUiAction(addWorkspaceDirectory, setStatus, 'failed to add directory'),
    onRemoveDirectory: (dir) => runUiAction(() => removeWorkspaceDirectory(dir), setStatus, 'failed to remove directory'),
  }

  const header = mobileHeaderTitle(screen, project?.name, activeSessionTitle, terminalUi.title)
  const tabletMultiPane = shouldUseTabletMultiPane(width, screen, !!project)

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      <MobileKeyboardFrame>
        <MobileHeader
        route={screen}
        title={header}
        subtitle={[project?.name, gitInfo?.branch].filter(Boolean).join(' · ')}
        provider={selectedProvider}
        acpAgentId={selectedAcpAgentId}
        streaming={streaming}
        connectionState={connectionState}
        onBack={back}
        onSwitchSession={() => setSessionSwitcherOpen(true)}
        onOpenTerminal={openTerminal}
        onOpenSettings={openSettings}
        />

        <View style={styles.contentRow}>
        {tabletMultiPane && project ? (
          <TabletSessionSidebar
            projectName={project.name}
            sessions={sessions}
            activeSessionId={sessionId}
            onOpenSession={(row) => void openSession(row)}
            onCreateSession={() => startNewSession()}
            onOpenSettings={openSettings}
            onArchiveSession={(row) => removeFromList(row, 'archive_session')}
            onDeleteSession={(row) => removeFromList(row, 'delete_session')}
          />
        ) : null}
          <View style={styles.mainPane}>
            <MobileNavigator
            route={screen}
            auxiliaryReturn={auxiliaryReturnRef.current}
            onRouteChange={(route) => {
              if (screen === 'chat' && route === 'sessions' && sessionId) {
                leaveActiveSession()
              }
              setScreen(route)
            }}
            renderScene={(route) => (
              <View style={route === 'chat' || route === 'terminal' ? styles.flex : styles.page}>
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
          onOpenScanner={() => runUiAction(openScanner, setStatus, 'camera failed')}
          onConnect={(item) => void connectToPairing(item)}
          onRename={(item, name) => runUiAction(
            () => updatePairings((current) => current.map((pairing) => pairing.id === item.id ? { ...pairing, name } : pairing)),
            setStatus,
            'failed to rename device',
          )}
          onForget={(item) => runUiAction(async () => {
            await updatePairings((current) => current.filter((pairing) => pairing.id !== item.id))
            if (activePairingId === item.id) {
              reconnectControllerRef.current?.cancel()
              clientRef.current?.disconnect()
              clientRef.current = null
              setActivePairingId(null)
              setActiveTransport(null)
              setReconnect(null)
              setConnectionState('offline')
            }
          }, setStatus, 'failed to forget device')}
        />
      ) : null}

      {route === 'projects' ? <ProjectsScreen projects={projects} onOpen={(item) => {
        runUiAction(() => openProject(item), setStatus, 'failed to open project')
      }} /> : null}

      {route === 'sessions' ? (
        <SessionsScreen
          sessions={sessions}
          onCreateSession={() => startNewSession()}
          onOpenSession={openSession}
          onArchiveSession={(row) => removeFromList(row, 'archive_session')}
          onDeleteSession={(row) => removeFromList(row, 'delete_session')}
        />
      ) : null}

      {route === 'settings' ? (
        <SettingsScreen {...settingsProps} />
      ) : null}

      {route === 'files' ? (
        <FilesScreen
          path={directoryPath}
          items={directoryItems}
          loading={directory.loading}
          error={directory.error}
          onOpenDirectory={(path) => runUiAction(() => loadDirectory(path), setStatus, 'failed to load directory')}
          onOpenFile={(path) => runUiAction(() => previewFile(path), setStatus, 'failed to open file')}
        />
      ) : null}

      {route === 'chat' ? (
        <ChatScreen provider={selectedProvider}
          starting={starting}
          landing={!sessionId ? { provider: selectedProvider, projectName: project?.name,
            branch: worktreeSelection.kind === 'create' ? worktreeSelection.branchName || 'New worktree'
              : worktreeSelection.kind === 'existing' ? worktreeSelection.branch || 'Worktree' : gitInfo?.branch ?? undefined, onProvider: selectProvider,
            onProject: () => setSessionSwitcherOpen(true), onWorktree: () => setWorktreeOpen(true) } : undefined}
          selection={{ model: selectedModel, models, providerName: harnessSelection.activeProviderName, onRefresh: refreshModels,
            effort: selectedEffort, efforts,
            onModel: harnessSelection.selectModel, onEffort: setSelectedEffort }}
          webRef={webRef}
          permissionModes={permModes}
          permissionMode={permMode}
          slashHits={slashHits}
          mentionHits={mentionHits}
          attachments={attachments}
          additionalDirectories={workspaceDirs}
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
          nativeDraft={{ controller: composerDraft.editorRef, document: composerDraft.document.current, onError: setStatus,
            onChange: (snapshot) => { composerDraft.accept(snapshot); suggestions.updateNative(snapshot.text, snapshot, snapshot.composing) } }}
          onSlash={(command) => {
            if (composerDraft.editorRef.current) composerDraft.editorRef.current.replaceText(`/${command} `)
            else onDraft(`/${command} `)
            suggestions.clear()
          }}
          onMention={(item) => {
            if (composerDraft.editorRef.current) { composerDraft.editorRef.current.insertMention(item); return }
            const value = suggestions.insert(item)
            if (value === undefined) return
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

      {route === 'terminal' ? (
        <ConnectedTerminal webRef={termRef} runtimeRef={termRuntimeRef} theme={webViewTheme}
          draft={termDraft} writable={terminalUi.writable} onDraft={setTermDraft} onStatus={setStatus} />
      ) : null}
              </View>
            )}
            />
          </View>
        </View>
      </MobileKeyboardFrame>
      {status ? <Text style={styles.meta}>{status}</Text> : null}
      <Sheet visible={worktreeOpen} title="Workspace for new session" onDismiss={() => setWorktreeOpen(false)}>
        <SettingsScreen {...settingsProps} section="worktree" />
      </Sheet>
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
        workspace={{ visible: sessionSwitcherOpen, onDismiss: () => setSessionSwitcherOpen(false),
          deviceName: pairings.find((item) => item.id === activePairingId)?.hostName ?? 'Desktop',
          projects, activeProject: project, activeSessionId: sessionId, sessions,
          loadSessions: (p) => clientRef.current ? readProjectSessions(clientRef.current, p.path) : Promise.reject(new Error('Not connected')),
          onNewSession: (p) => runUiAction(async () => { await openProject(p); startNewSession(p) }, setStatus, 'failed to open project'),
          onOpenSession: (p, row) => runUiAction(async () => { if (p.path !== project?.path) await openProject(p); await openSession(row, p) }, setStatus, 'failed to open session'),
        }}
        sharedFileInbox={sharedFileInbox}
      />
    </SafeAreaView>
  )
}
