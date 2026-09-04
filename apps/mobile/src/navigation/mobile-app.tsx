import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as Clipboard from 'expo-clipboard'
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { Bot, ArrowLeft, MessageSquare, Settings, SquareTerminal } from 'lucide-react-native'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { HostOutbound } from '@superone/chat-view'
import {
  loadPairings,
  parsePairQr,
  RelayClient,
  savePairings,
  startPairingHandshake,
  upsertPairing,
  type SavedPairing,
} from '@superone/relay-client'
import type {
  AskUserQuestionRequest,
  ChatMessage,
  HarnessId,
  ImageAttachment,
  PermissionRequest,
  PlanApprovalRequest,
  RemoteCommand,
  TodoItem,
  WorktreeInfo,
} from '@superone/shared/agent-types'
import { ChatRuntime } from '../runtime'
import { TerminalRuntime } from '../terminal-runtime'
import { randomId } from '../ids'
import { isPairingQrInput, normalizePairingInput } from '../pairing-input'
import { usePairingDeepLink } from '../pairing-deep-link'
import { mergeMentionItems, shouldSubmitFromKeyboard } from '../composer-state'
import { CHAT_WINDOW } from '../chat-window'
import { filterSlashCommands } from '../slash'
import { extractMentionQuery, insertMention, type MentionItem } from '../mentions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { PermissionSheet, PlanSheet, QuestionSheet } from '../sheets'
import { harnessDisplayName, harnessSupportsAdditionalDirs } from '../provider-state'
import { parentRemotePath, resolveRemoteFilePath, type RemoteDirectoryEntry } from '../shell-state'
import { loadOrCreateMobileId, mobileKv } from '../storage'
import { registerFatalChatViewError } from '../chat-view-recovery'
import {
  pickAndUploadProjectFile,
  pickChatImages,
  pickChatPdf,
  showAttachmentMenu,
} from '../attachments'
import { SettingsScreen, type ModelRow, type ShellGitInfo } from '../screens/settings-screen'
import {
  buildWorktreeCreateOptions,
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from '../worktree-state'
import { shouldUseTabletMultiPane } from '../layout-state'
import { TabletSessionSidebar, type TabletSessionRow as SessionRow } from './tablet-session-sidebar'
import { resolveNativeRequest } from '../native-actions'
import { SharedFileSheet, useSharedFileInbox } from '../shared-file-inbox'
import type { ReconnectController } from '../reconnect-controller'
import { createMobileRelayConnection } from '../mobile-relay-connection'
import { SessionTransition } from '../session-transition'
import { ProjectsScreen, type Project } from '../screens/projects-screen'
import { runUiAction } from '../ui-action'
import { FilesScreen } from '../screens/files-screen'
import { ChatScreen } from '../screens/chat-screen'
import { PairingsScreen } from '../screens/pairings-screen'
import { TerminalScreen } from '../screens/terminal-screen'
import { SessionsScreen } from '../screens/sessions-screen'
import { MobileNavigator, type MobileRoute as Screen } from './mobile-navigator'
import { Badge, ListRow, Sheet } from '../ui'
type ChatViewState = Extract<HostOutbound, { type: 'viewState' }>
const kv = mobileKv
const CHAT_VIEW_STATE_KEY = 'superone:chat-view-state'
export function MobileApp() {
  const styles = useMobileStyles()
  const { tokens, setHarness } = useMobileTheme()
  const webViewTheme = useMemo(() => mobileWebViewTheme(tokens), [tokens])
  const { width } = useWindowDimensions()
  const [screen, setScreen] = useState<Screen>('pair')
  const [paste, setPaste] = useState('')
  const [lan, setLan] = useState('')
  const [status, setStatus] = useState('Paste a superone://pair QR or {relayUrl,secret} JSON')
  const [code, setCode] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [pairings, setPairings] = useState<SavedPairing[]>([])
  const [activePairingId, setActivePairingId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<HarnessId>('claude')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [gitInfo, setGitInfo] = useState<ShellGitInfo | null>(null)
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [checkedOutBranches, setCheckedOutBranches] = useState<string[]>([])
  const [worktreeSelection, setWorktreeSelection] = useState<NewSessionWorktreeSelection>(LOCAL_WORKTREE_SELECTION)
  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>([])
  const [additionalDir, setAdditionalDir] = useState('')
  const [directoryPath, setDirectoryPath] = useState('')
  const [directoryItems, setDirectoryItems] = useState<RemoteDirectoryEntry[]>([])
  const [draft, setDraft] = useState('')
  const [termDraft, setTermDraft] = useState('')
  const [terminalUi, setTerminalUi] = useState({ writable: false, title: 'Terminal' })
  const [streaming, setStreaming] = useState(false)
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'offline'>('offline')
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [permMode, setPermMode] = useState('default')
  const [permModes, setPermModes] = useState<string[]>(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
  const [slashHits, setSlashHits] = useState<ReturnType<typeof filterSlashCommands>>([])
  const [mentionHits, setMentionHits] = useState<MentionItem[]>([])
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([])
  const [todos, setTodos] = useState<Record<string, TodoItem>>({})
  const [perm, setPerm] = useState<PermissionRequest | null>(null)
  const [plan, setPlan] = useState<PlanApprovalRequest | null>(null)
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const sharedFileInbox = useSharedFileInbox()
  const webRef = useRef<WebView>(null)
  const termRef = useRef<WebView>(null)
  const clientRef = useRef<RelayClient | null>(null)
  const runtimeRef = useRef<ChatRuntime | null>(null)
  const termRuntimeRef = useRef<TerminalRuntime | null>(null)
  const reconnectControllerRef = useRef<ReconnectController | null>(null)
  const connectionRef = useRef<{ state: 'connected' | 'reconnecting'; epoch: number }>({ state: 'connected', epoch: 0 })
  const sessionTransitionRef = useRef(new SessionTransition())
  const chatViewStatesRef = useRef<Record<string, ChatViewState>>({})
  const viewStateWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fatalReloadRef = useRef({ startedAt: 0, count: 0 })
  const draftRef = useRef('')
  const lastDraftChangeAtRef = useRef(0)
  const mentionRequestRef = useRef(0)
  const auxiliaryReturnRef = useRef<'sessions' | 'chat'>('sessions')
  const suppressReconnectRef = useRef(false)
  const scanningRef = useRef(false)
  useEffect(() => {
    void loadPairings(kv).then(setPairings).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'failed to load pairings')
    })
    void loadOrCreateMobileId().then(setDeviceId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'failed to initialize device')
    })
    void kv.get(CHAT_VIEW_STATE_KEY).then((raw) => {
      if (!raw) return
      try {
        chatViewStatesRef.current = JSON.parse(raw) as Record<string, ChatViewState>
      } catch { /* ignore corrupt view state */ }
    })
    return () => {
      if (viewStateWriteTimerRef.current != null) clearTimeout(viewStateWriteTimerRef.current)
      reconnectControllerRef.current?.cancel()
    }
  }, [])
  const inject = (ref: RefObject<WebView | null>, msg: unknown) => {
    ref.current?.injectJavaScript(`globalThis.__applyHost(${JSON.stringify(msg)});true;`)
  }
  useEffect(() => {
    inject(webRef, webViewTheme)
    inject(termRef, webViewTheme)
  }, [webViewTheme])
  const syncSheets = (runtime: ChatRuntime, hydrate = false) => {
    if (connectionRef.current.epoch !== runtime.epoch) {
      connectionRef.current = { state: 'connected', epoch: runtime.epoch }
      setConnectionState('connected')
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
    }
    const pending = runtime.session.pendingPermissions[0]
    inject(webRef, {
      type: hydrate ? 'hydrate' : 'applyReductionPatch',
      messages: runtime.session.messages,
      todos: runtime.session.todos,
      pendingPermission: pending
        ? { requestId: pending.requestId, toolName: pending.toolName, toolUseId: pending.toolUseId }
        : null,
    })
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
      inject(webRef, { type: 'setViewport', fontScale: 1, locale: 'en' })
      inject(webRef, { type: 'setConnection', ...connectionRef.current })
      syncSheets(runtimeRef.current, true)
      const saved = chatViewStatesRef.current[runtimeRef.current.sessionId]
      if (saved) inject(webRef, { type: 'setWindow', range: saved.range, anchorId: saved.anchorId })
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
        if (__DEV__) {
          const eventTypes = events.map((event) => (
            event && typeof event === 'object' && 'type' in event
              ? String((event as { type: unknown }).type)
              : 'unknown'
          ))
          console.debug('[relay] decrypted AgentEvents', eventTypes)
        }
        runtimeRef.current?.ingest(events, epoch)
      },
      onTerminal: (payload) => termRuntimeRef.current?.ingest(payload),
      restore: async (activeClient) => {
        const runtime = runtimeRef.current
        if (!runtime) return activeClient.releaseBuffer().epoch
        await runtime.reopen()
        return runtime.epoch
      },
      currentEpoch: (activeClient) => runtimeRef.current?.epoch ?? activeClient.buffer.epoch,
      onConnection: (state, epoch) => {
        connectionRef.current = { state, epoch }
        setConnectionState(state)
        inject(webRef, { type: 'setConnection', state, epoch })
        setStatus(state === 'connected' ? 'connected' : 'disconnected — reconnecting')
      },
      onStatus: setStatus,
      onShutdown: () => {
        setConnectionState('offline')
        setStatus('desktop shut down')
      },
      suppressDisconnect: () => suppressReconnectRef.current,
    })
    reconnectControllerRef.current = reconnectController
    clientRef.current = client
    const hp = (lanHostPort ?? lan).trim()
    if (hp.includes(':')) {
      const [host, port] = hp.split(':')
      await client.connectLan(host, Number(port), secret)
    } else {
      await client.connectRelay({ relayUrl, masterSecret: secret, deviceId: activeDeviceId })
    }
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
    setScreen('projects')
    setStatus(`${res.projects?.length ?? 0} projects`)
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
        await connectWithSecret(paired.relayUrl || qr.relayUrl, paired.masterSecret, undefined, paired.hostName, qr.desktopDeviceId)
        return
      }
      const json = JSON.parse(raw) as { relayUrl?: string; secret?: string; url?: string }
      const url = json.relayUrl ?? json.url
      if (!url || !json.secret) throw new Error('JSON needs relayUrl and secret')
      await connectWithSecret(url, json.secret)
    } catch (e) {
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
    const res = await client.request({
      type: 'list_sessions',
      requestId: randomId(),
      projectPath: p.path,
      limit: 30,
      offset: 0,
    } as RemoteCommand) as { sessions?: SessionRow[]; error?: string }
    if (res.error) {
      setStatus(res.error)
      return
    }
    setSessions(res.sessions ?? [])
    const git = await client.request({
      type: 'get_git_info',
      requestId: randomId(),
      projectPath: p.path,
    } as RemoteCommand).catch(() => null) as ShellGitInfo | null
    setGitInfo(git)
    setScreen('sessions')
  }
  const loadShellDetails = async (provider: HarnessId = selectedProvider) => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const [git, resources, worktree, system, branchResult, checkedOutResult] = await Promise.all([
      client.request({ type: 'get_git_info', requestId: randomId(), projectPath: p.path } as RemoteCommand)
        .catch(() => null) as Promise<ShellGitInfo | null>,
      client.request({
        type: 'get_project_resources',
        requestId: randomId(),
        projectPath: p.path,
        provider,
      } as RemoteCommand).catch(() => null) as Promise<{ workspaceDirs?: string[] } | null>,
      client.request({ type: 'get_worktree_info', requestId: randomId(), projectPath: p.path } as RemoteCommand)
        .catch(() => null) as Promise<WorktreeInfo | null>,
      client.request({
        type: 'get_system_info',
        requestId: randomId(),
        projectPath: p.path,
        provider,
      } as RemoteCommand).catch(() => null) as Promise<{ models?: ModelRow[]; defaults?: { model?: string | null } } | null>,
      client.request({ type: 'get_git_branches', requestId: randomId(), projectPath: p.path } as RemoteCommand)
        .catch(() => null) as Promise<{ branches?: string[] } | null>,
      client.request({ type: 'get_checked_out_branches', requestId: randomId(), projectPath: p.path } as RemoteCommand)
        .catch(() => null) as Promise<{ branches?: string[] } | null>,
    ])
    setGitInfo(git)
    setWorkspaceDirs(resources?.workspaceDirs ?? [])
    setWorktreeInfo(worktree)
    setModels(system?.models ?? [])
    setSelectedModel(system?.defaults?.model ?? '')
    setBranches(branchResult?.branches ?? [])
    setCheckedOutBranches(checkedOutResult?.branches ?? [])
  }

  const openSettings = () => {
    auxiliaryReturnRef.current = screen === 'chat' ? 'chat' : 'sessions'
    setScreen('settings')
    void loadShellDetails()
  }

  const loadDirectory = async (path: string): Promise<boolean> => {
    const client = clientRef.current
    if (!client) return false
    const result = await client.request({
      type: 'list_directory',
      requestId: randomId(),
      path,
    } as RemoteCommand) as { items?: RemoteDirectoryEntry[]; error?: string }
    if (result.error) {
      setStatus(result.error)
      return false
    }
    setDirectoryPath(path)
    setDirectoryItems(result.items ?? [])
    return true
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

  const failSessionTransition = (error: unknown) => {
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    termRuntimeRef.current = null
    setSessionId(null)
    setActiveSessionTitle('')
    setScreen('sessions')
    setStatus(error instanceof Error ? error.message : 'session transition failed')
  }
  const openSession = (row: SessionRow) => sessionTransitionRef.current.run(async () => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const previousId = runtimeRef.current?.sessionId
    if (previousId && previousId !== row.sessionId) {
      client.send({ type: 'unsubscribe_session', sessionId: previousId })
    }
    setSessionId(row.sessionId)
    setActiveSessionTitle(row.title || 'Untitled')
    const provider = (row.provider ?? 'claude') as HarnessId
    setSelectedProvider(provider)
    setHarness(provider)
    const runtime = bindRuntime(client)
    setScreen('chat')
    await runtime.open(p.path, row.sessionId)
    const info = await runtime.loadSystemInfo(provider)
    setModels(info.models ?? [])
    setSelectedModel(info.defaults?.model ?? '')
    if (info.permissionModes?.length) setPermModes(info.permissionModes)
    else if (info.permissionPresets?.length) setPermModes(info.permissionPresets)
  }).catch(failSessionTransition)

  const createSession = () => {
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
    void sessionTransitionRef.current.run(async () => {
      const previousId = runtimeRef.current?.sessionId
      if (previousId) client.send({ type: 'unsubscribe_session', sessionId: previousId })
      const runtime = bindRuntime(client)
      const id = await runtime.create(p.path, {
        provider: selectedProvider,
        ...(selectedModel ? { model: selectedModel } : {}),
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
      setModels(info.models ?? [])
      if (info.permissionModes?.length) setPermModes(info.permissionModes)
    }).catch(failSessionTransition)
  }

  const send = async () => {
    const text = draft.trim()
    const runtime = runtimeRef.current
    if ((!text && attachments.length === 0) || !runtime) return
    try {
      await runtime.send(text, { images: attachments, ...(selectedModel ? { model: selectedModel } : {}) })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'message failed')
      return
    }
    draftRef.current = ''
    setDraft('')
    setAttachments([])
    setSlashHits([])
    setMentionHits([])
  }

  const onDraft = (text: string) => {
    draftRef.current = text
    lastDraftChangeAtRef.current = Date.now()
    setDraft(text)
    const runtime = runtimeRef.current
    setSlashHits(filterSlashCommands(text, runtime?.slashCommands ?? []))
    const q = extractMentionQuery(text, text.length)
    const request = ++mentionRequestRef.current
    if (!q) {
      setMentionHits([])
      return
    }
    setMentionHits(mergeMentionItems(q.query, []))
    void runtime?.searchMentions(q.query).then((res) => {
      if (mentionRequestRef.current !== request) return
      const items = (res.items ?? []).map((row) => {
        const r = row as Record<string, unknown>
        return {
          kind: String(r.kind ?? 'file'),
          path: String(r.path ?? r.name ?? ''),
          isDirectory: Boolean(r.isDirectory),
        }
      }).filter((m) => m.path)
      setMentionHits(mergeMentionItems(q.query, items))
    }).catch(() => { /* remote mention search is optional */ })
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
      const sid = sessionId
      if (sid) runUiAction(() => clientRef.current?.send({ type: 'unsubscribe_session', sessionId: sid }), setStatus, 'unsubscribe failed')
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

  const header = useMemo(() => {
    if (screen === 'projects') return 'Projects'
    if (screen === 'sessions') return project?.name ?? 'Sessions'
    if (screen === 'chat') return activeSessionTitle || 'Chat'
    if (screen === 'terminal') return terminalUi.title
    if (screen === 'settings') return 'Project settings'
    if (screen === 'files') return 'Files'
    return 'SuperOne'
  }, [activeSessionTitle, screen, project, terminalUi.title])
  const tabletMultiPane = shouldUseTabletMultiPane(width, screen, !!project)

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.top}>
        {screen !== 'pair' ? (
          <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={back}>
            <ArrowLeft color={tokens.colors.primary} size={22} />
          </Pressable>
        ) : <View />}
        <View style={styles.headerTitleGroup}>
          <View style={styles.headerTitleRow}>
            {screen === 'chat' ? <Bot color={tokens.colors.primary} size={18} /> : null}
            <Text numberOfLines={1} style={styles.title}>{header}</Text>
            {screen === 'chat' && streaming ? <ActivityIndicator color={tokens.colors.primary} size="small" /> : null}
          </View>
          {screen === 'chat' ? (
            <View style={styles.headerMetaRow}>
              <Badge label={harnessDisplayName(selectedProvider)} />
              <Badge
                label={connectionState}
                tone={connectionState === 'connected' ? 'success' : connectionState === 'reconnecting' ? 'warning' : 'error'}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {screen === 'chat' ? (
            <Pressable accessibilityLabel="Switch session" accessibilityRole="button" onPress={() => setSessionSwitcherOpen(true)}>
              <MessageSquare color={tokens.colors.primary} size={21} />
            </Pressable>
          ) : null}
          {screen === 'chat' ? (
            <Pressable accessibilityLabel="Terminal" accessibilityRole="button" onPress={openTerminal}>
              <SquareTerminal color={tokens.colors.primary} size={21} />
            </Pressable>
          ) : null}
          {screen === 'chat' || screen === 'sessions' ? (
            <Pressable accessibilityLabel="Settings" accessibilityRole="button" onPress={openSettings}>
              <Settings color={tokens.colors.primary} size={21} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.contentRow}>
        {tabletMultiPane && project ? (
          <TabletSessionSidebar
            projectName={project.name}
            sessions={sessions}
            activeSessionId={sessionId}
            onOpenSession={(row) => void openSession(row)}
            onCreateSession={() => void createSession()}
            onOpenSettings={openSettings}
          />
        ) : null}
        <View style={styles.mainPane}>
          <MobileNavigator
            route={screen}
            auxiliaryReturn={auxiliaryReturnRef.current}
            onRouteChange={(route) => {
              if (screen === 'chat' && route === 'sessions' && sessionId) {
                runUiAction(
                  () => clientRef.current?.send({ type: 'unsubscribe_session', sessionId }),
                  setStatus,
                  'unsubscribe failed',
                )
              }
              setScreen(route)
            }}
            renderScene={(route) => (
              <>
      {route === 'pair' ? (
        <PairingsScreen
          scannerOpen={scannerOpen}
          paste={paste}
          lan={lan}
          code={code}
          pairings={pairings}
          activePairingId={activePairingId}
          connected={connectionState === 'connected'}
          onBarcodeScanned={onBarcodeScanned}
          onCancelScanner={() => setScannerOpen(false)}
          onPasteChange={setPaste}
          onLanChange={setLan}
          onPair={() => void onPair()}
          onOpenScanner={() => runUiAction(openScanner, setStatus, 'camera failed')}
          onConnect={(item) => void connectWithSecret(item.relayUrl, item.secret, item.lan || lan, item.hostName, item.desktopDeviceId)
            .catch((error) => setStatus(error instanceof Error ? error.message : 'connect failed'))}
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
              setConnectionState('offline')
            }
          }, setStatus, 'failed to forget device')}
        />
      ) : null}

      {route === 'projects' ? <ProjectsScreen projects={projects} onOpen={(item) => {
        runUiAction(() => openProject(item), setStatus, 'failed to open project')
      }} /> : null}

      {route === 'sessions' ? (
        <SessionsScreen sessions={sessions} onCreateSession={createSession} onOpenSession={openSession} />
      ) : null}

      {route === 'settings' ? (
        <SettingsScreen
          gitInfo={gitInfo}
          worktreeInfo={worktreeInfo}
          branches={branches}
          checkedOutBranches={checkedOutBranches}
          worktreeSelection={worktreeSelection}
          onWorktreeSelectionChange={setWorktreeSelection}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          models={models}
          workspaceDirs={workspaceDirs}
          additionalDir={additionalDir}
          onAdditionalDirChange={setAdditionalDir}
          onProviderChange={(provider) => {
            setSelectedProvider(provider)
            setHarness(provider)
            setSelectedModel('')
            if (provider !== 'claude') setWorktreeSelection(LOCAL_WORKTREE_SELECTION)
            void loadShellDetails(provider)
          }}
          onModelChange={setSelectedModel}
          onOpenFiles={openFiles}
          onAddDirectory={() => runUiAction(addWorkspaceDirectory, setStatus, 'failed to add directory')}
          onRemoveDirectory={(dir) => runUiAction(() => removeWorkspaceDirectory(dir), setStatus, 'failed to remove directory')}
        />
      ) : null}

      {route === 'files' ? (
        <FilesScreen
          path={directoryPath}
          items={directoryItems}
          onOpenDirectory={(path) => runUiAction(() => loadDirectory(path), setStatus, 'failed to load directory')}
          onOpenFile={(path) => runUiAction(() => previewFile(path), setStatus, 'failed to open file')}
        />
      ) : null}

      {route === 'chat' ? (
        <ChatScreen
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
          onSlash={(command) => { onDraft(`/${command} `); setSlashHits([]) }}
          onMention={(item) => {
            const query = extractMentionQuery(draft, draft.length)
            if (query) onDraft(insertMention(draft, query, item))
            setMentionHits([])
          }}
          onRemoveAttachment={(attachment) => setAttachments((current) => current.filter((item) => item !== attachment))}
          onAttachmentMenu={() => showAttachmentMenu({
            image: () => void addAttachment('image'),
            pdf: () => void addAttachment('pdf'),
            file: () => void uploadProjectFile(),
          })}
          onDraft={onDraft}
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
        <TerminalScreen
          webRef={termRef}
          draft={termDraft}
          writable={terminalUi.writable}
          onWebMessage={(raw) => {
            try {
              const message = JSON.parse(raw) as { type?: string }
              if (message.type === 'terminalReady') inject(termRef, webViewTheme)
            } catch { /* terminal runtime ignores malformed messages too */ }
            termRuntimeRef.current?.handleViewMessage(raw)
          }}
          onDraft={setTermDraft}
          onSubmit={() => {
            const line = termDraft
            runUiAction(() => { termRuntimeRef.current?.input(`${line}\n`); setTermDraft('') }, setStatus, 'terminal input failed')
          }}
          onClaim={() => runUiAction(() => termRuntimeRef.current?.claim(), setStatus, 'terminal claim failed')}
          onKey={(data) => runUiAction(() => termRuntimeRef.current?.input(data), setStatus, 'terminal input failed')}
        />
      ) : null}
              </>
            )}
          />
        </View>
      </View>
      <Text style={styles.meta}>{status} · window {CHAT_WINDOW.initialTurns}</Text>

      <PermissionSheet
        perm={perm}
        onAllow={(id, formAnswers, alwaysAllow) => runUiAction(
          () => runtimeRef.current?.respondPermission(id, true, formAnswers, alwaysAllow),
          setStatus,
          'permission response failed',
        )}
        onDeny={(id) => runUiAction(() => runtimeRef.current?.respondPermission(id, false), setStatus, 'permission response failed')}
      />
      <PlanSheet
        plan={plan}
        onApprove={(id) => runUiAction(() => runtimeRef.current?.respondPlan(id, true), setStatus, 'plan response failed')}
        onReject={(id) => runUiAction(() => runtimeRef.current?.respondPlan(id, false, 'rejected from mobile'), setStatus, 'plan response failed')}
      />
      <QuestionSheet
        question={question}
        answers={answers}
        onPick={(header, label) => setAnswers((prev) => ({ ...prev, [header]: label }))}
        onSubmit={(id) => runUiAction(() => runtimeRef.current?.answerQuestion(id, answers), setStatus, 'question response failed')}
        onDismiss={(id) => runUiAction(() => runtimeRef.current?.dismissQuestion(id), setStatus, 'question response failed')}
      />
      <Sheet visible={sessionSwitcherOpen} title="Switch session" onDismiss={() => setSessionSwitcherOpen(false)}>
        <View style={styles.sessionSwitcherList}>
          {sessions.map((row) => (
            <ListRow
              key={row.sessionId}
              title={row.title || 'Untitled'}
              subtitle={row.provider}
              selected={row.sessionId === sessionId}
              onPress={() => {
                setSessionSwitcherOpen(false)
                void openSession(row)
              }}
            />
          ))}
        </View>
      </Sheet>
      <SharedFileSheet inbox={sharedFileInbox} />
    </SafeAreaView>
  )
}
