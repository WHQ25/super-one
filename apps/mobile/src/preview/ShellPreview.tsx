import { DraftsPreview } from '../navigation/workspace-drafts.stories'
import { useComposerSend } from '../navigation/use-composer-send'
import { useComposerDraft } from '../navigation/use-composer-draft'
import { extractMentionQuery, insertMention, type MentionItem } from '../mentions'
import type { MentionEditorSnapshot } from '../mention-editor-state'
import { MentionEditorPreview } from './MentionEditorPreview'
import { ComposerSuggestionsGallery } from './ComposerSuggestionsGallery'
import { previewAgentProfiles, previewCapabilityIds, previewMentionItems, previewSlashCatalog } from './composer-fixtures'
import { filterSlashCommands } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import { replaceFirstLine } from '../composer-first-line'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { WebView } from 'react-native-webview'
import type { ChatMessage, HarnessId, ImageAttachment, ModelOption, RemoteHarnessOption, RemoteSystemInfo, SandboxInfo, TodoItem, SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import { MobileHeader, mobileHeaderTitle } from '../navigation/mobile-header'
import { useMobileLocale } from '../i18n/context'
import { MobileKeyboardFrame } from '../navigation/mobile-keyboard-frame'
import { WorkspaceDrawer } from '../navigation/workspace-drawer'
import { WorkspaceSidebar } from '../navigation/workspace-sidebar'
import { WorkspaceListCache } from '../workspace-list-cache'
import { ChatScreen } from '../screens/chat-screen'
import { FilesScreen } from '../screens/files-screen'
import { FileFinderView } from '../screens/file-finder-view'
import { buildMentionRows, type MentionRow } from '../mention-rows'
import { buildGitToneMap } from '../navigation/use-project-git-status'
import type { FileBrowserMode } from '../shell-state'
import { PairingsScreen } from '../screens/pairings-screen'
import type { SavedPairing } from '@superone/relay-client'
import type { DeviceStatus } from '../device-status'
import { describeSessionGit } from '../session-git-status'
import { SessionStatusGallery } from './SessionStatusGallery'
import { BranchScreen } from '../screens/branch-screen'
import { WorktreeScreen } from '../screens/worktree-screen'
import { ProjectPickerScreen } from '../screens/project-picker-screen'
import { AddProjectScreen } from '../screens/add-project-screen'
import { useAddProject } from '../navigation/use-add-project'
import { previewAddProjectRequest } from './add-project-fixtures'
import { suggestionHarnessKey } from '@superone/shared/suggestion-harness-order'
import { AppSettingsScreen } from '../screens/app-settings-screen'
import { UpdatePromptGallery } from './UpdatePromptGallery'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import { TerminalScreen } from '../screens/terminal-screen'
import { isFullBleedScreen, shouldUseTabletMultiPane } from '../layout-state'
import { worktreeSelectionError } from '../worktree-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { injectHostMessage } from '../native-actions'
import { Button, SelectionField, Sheet } from '../ui'
import { StatusBanner } from '../ui/status-banner'
import { GitIndicatorGallery } from './GitIndicatorGallery'
import { FilePreviewGallery } from './FilePreviewGallery'

/** Two folders, one of them long enough to prove the hint row scrolls. */
const PREVIEW_ADDITIONAL_DIRS = [
  '/Users/dev/Developer/Projects/super-one-design-system',
  '/Users/dev/Developer/Projects/shared-protocol-schemas',
]

/** What the folder browser lists offline, so both steps are reviewable. */
const PREVIEW_FOLDER_ENTRIES = ['super-one', 'super-one-flutter', 'shared-protocol-schemas', 'scratch']
  .map((name) => ({ name, path: `/Users/dev/Developer/Projects/${name}` }))

import {
  PREVIEW_BRANCHES,
  PREVIEW_CHECKED_OUT,
  PREVIEW_GIT_INFO,
  PREVIEW_WORKTREE_DIRTY,
  PREVIEW_WORKTREE_INFO,
  previewSwitchBranch,
} from './git-fixtures'
import { IconGallery } from './IconGallery'
import { LoadingStateGallery } from './LoadingStateGallery'
import { answerTranscriptRequest, transcriptProjection, transcriptStates, type TranscriptState } from './transcript-fixtures'
import { sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import { AddDirScreen } from '../screens/add-dir-screen'
import { CollabRequestScreen } from '../screens/collab-request-screen'
import { CollabTaskScreen } from '../screens/collab-task-screen'
import { permissionExamples } from './permissions'
import type { AddDirScope, AddDirStep } from '../add-dir-state'
import { appendBrowsePathSegment } from '@superone/shared/path-browse'
import { LanBrowserPreview } from './LanBrowserPreview'
import { effortOptionsForModel, resolveSelectedEffort } from '../model-selection-state'
import { optionParamsForModel } from '../model-picker-state'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { shellPreviewPages, type ShellPreviewPage as Page } from './preview-route'
import { previewRelayClient } from './preview-relay-client'
import { SessionSearchScreen } from '../screens/session-search-screen'

// The tool catalog is its own screen, not a page of this shell — see ToolCatalogPreview.
const pages = shellPreviewPages.filter((page) => page !== 'Tool catalog')

const PREVIEW_PROJECT_FILES = [
  { name: 'screens', isDirectory: true },
  { name: 'chat-screen.tsx', isDirectory: false },
  { name: 'files-screen.tsx', isDirectory: false },
  { name: 'runtime.ts', isDirectory: false },
  { name: 'mobile-review.png', isDirectory: false },
]
const PREVIEW_COMPUTER_FILES = [
  { name: 'Projects', isDirectory: true },
  { name: 'Github', isDirectory: true },
  { name: 'notes.md', isDirectory: false },
]
const PREVIEW_COMPLETIONS = [
  { name: 'Developer', isDirectory: true },
  { name: 'Devtools', isDirectory: true },
]
const PREVIEW_SEARCH_RESULTS = [
  { path: 'apps/mobile/src/screens/chat-screen.tsx', isDirectory: false, matchIndices: [24, 25, 26, 27], score: 1 },
  { path: 'apps/mobile/src/screens/chat-composer.tsx', isDirectory: false, matchIndices: [24, 25, 26, 27], score: 0.9 },
  { path: 'packages/chat-view/src/index.ts', isDirectory: false, matchIndices: [9, 10, 11, 12], score: 0.7 },
]
// One of each tone, so the palette can be read at a glance in both schemes.
const PREVIEW_GIT_TONES = buildGitToneMap([
  // Unstaged: coloured but dimmed.
  { path: 'apps/mobile/src/chat-screen.tsx', index: null, worktree: 'M' },
  // Staged addition: full strength.
  { path: 'apps/mobile/src/files-screen.tsx', index: 'A', worktree: null },
  { path: 'apps/mobile/src/runtime.ts', index: 'M', worktree: 'M' },
  // Only inside `screens/`, so the folder row is what carries it.
  { path: 'apps/mobile/src/screens/gone.ts', index: 'D', worktree: null },
])
import { dynamicMentionArtworkSnapshot } from '../ui/mention-dynamic-artwork'

const previewModels: ModelOption[] = [
  { id: 'preview-model', name: 'Preview model', description: 'Balanced model · offline fixture', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportedReasoningEfforts: [{ value: 'low', description: 'Quickest answers' }, { value: 'medium', description: 'Balanced reasoning' }, { value: 'high', description: 'Deeper reasoning' }, { value: 'max', description: 'Longest thinking budget' }],
    serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }],
    parameters: [
      { id: 'thinking', values: [{ value: 'true' }, { value: 'false' }] },
      { id: 'optimize_for', values: [{ value: 'balanced' }, { value: 'speed', displayName: 'Speed' }, { value: 'quality', displayName: 'Quality' }] },
    ] },
  { id: 'preview-fast', name: 'Preview fast', description: 'Quick replies · offline fixture' },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `preview-catalog-${index + 1}`, name: `Catalog model ${index + 1}`,
    description: 'Extended offline catalog for search, scrolling and large-text checks',
  })),
]
type PreviewCatalog = Partial<Pick<RemoteSystemInfo, 'agents' | 'selectedAgentId' | 'modes' | 'selectedModeId' | 'modeLabel' | 'modesLocked' | 'providers' | 'selectedProviderId'>>

const PREVIEW_CATALOGS: Partial<Record<HarnessId, PreviewCatalog>> = {
  claude: {
    providers: [
      { id: null, name: 'Claude', brand: 'claude' },
      { id: 'cred-kimi', name: 'Kimi · work key', brand: 'kimi', keyName: 'work key' },
    ],
    selectedProviderId: null,
  },
  opencode: {
    agents: [
      { id: 'build', name: 'build', description: 'Write and run code' },
      { id: 'plan', name: 'plan', description: 'Read-only planning' },
      { id: 'general', name: 'general', description: 'Broad tasks' },
    ],
    selectedAgentId: 'build',
  },
  acp: {
    modes: [{ id: 'ask', name: 'Ask', description: 'Answer without editing' }, { id: 'code', name: 'Code', description: 'Edit files directly' }],
    selectedModeId: 'code',
    modeLabel: 'Mode',
  },
  dsh: {
    modes: [
      { id: 'default', name: 'Default', description: 'Shipped composition' },
      { id: 'research', name: 'Research', description: 'Reads more before writing' },
    ],
    selectedModeId: 'default',
    modeLabel: 'Preset',
  },
}

/** Every row shape the strip has to survive: done, running with live commentary,
 *  a delegated row, and one gated by two unfinished todos. */
const previewTodos: Record<string, TodoItem> = Object.fromEntries(([
  { id: '1', subject: 'chat-view: drop the duplicated Tasks card', description: '', status: 'completed' },
  { id: '2', subject: 'Port the Flutter todo strip', activeForm: 'Porting the Flutter todo strip', description: 'Row chrome, blockers and the 140 pt scroll cap', status: 'in_progress' },
  { id: '3', subject: 'Give the tablet the desktop card', description: 'Inset, rounded, hairlined', status: 'pending' },
  { id: '4', subject: 'Hand the sub-plan to a worker', description: '', status: 'pending', owner: 'codex-worker', blockedBy: ['2'] },
  { id: '5', subject: 'typecheck + scoped tests', description: '', status: 'pending', blockedBy: ['3', '4'] },
] satisfies TodoItem[]).map((item) => [item.id, item]))

const project = { name: 'super-one', path: '/workspace/super-one' }
/**
 * What a real host answers `list_harness_options` with: ordered, labelled, and
 * with the ACP harness expanded into one row per agent.
 */
const PREVIEW_HARNESS_OPTIONS: RemoteHarnessOption[] = [
  { key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude Code' },
  { key: 'codex', provider: 'codex', acpAgentId: null, label: 'Codex' },
  { key: 'acp:grok-build', provider: 'acp', acpAgentId: 'grok-build', label: 'Grok Build' },
  { key: 'opencode', provider: 'opencode', acpAgentId: null, label: 'OpenCode' },
  { key: 'cursor', provider: 'cursor', acpAgentId: null, label: 'Cursor' },
  { key: 'dsh', provider: 'dsh', acpAgentId: null, label: 'DeepSeek' },
]

const previewProjects = [
  project,
  { name: 'design-system', path: '/workspace/design-system' },
  // The field is sized by the selected name, so keep one that has to truncate.
  { name: 'internal-platform-observability', path: '/workspace/internal-platform-observability' },
]

/** One saved device per connection state, so the whole status vocabulary is reviewable. */
const previewDevices: { pairing: SavedPairing; status: DeviceStatus }[] = [
  { pairing: device('desk-lan-connected', 'Studio iMac', '192.168.1.9:8123'), status: 'connectedLan' },
  { pairing: device('desk-search', 'MacBook Pro', '192.168.1.18:8123'), status: 'searchingLan' },
  { pairing: device('desk-lan', 'Workshop mini', '192.168.1.24:8123'), status: 'onlineLan' },
  { pairing: device('desk-cloud', 'Office MacBook Pro'), status: 'onlineCloud' },
  { pairing: device('desk-retry', 'Loft desktop'), status: 'connecting' },
  { pairing: device('desk-offline', 'Old laptop'), status: 'offline' },
]

function device(id: string, hostName: string, lan?: string): SavedPairing {
  return { id, hostName, lan, relayUrl: 'wss://relay.super-one.dev', secret: 'a'.repeat(64) }
}
const sessions = [
  { sessionId: 'preview-1', title: 'Review the mobile interface and accessibility', provider: 'claude' as const, gitBranch: 'feat/mobile-ui', status: 'streaming' },
  { sessionId: 'preview-1-child', title: 'Port the tool rows to chat-view', provider: 'codex' as const, parentSessionId: 'preview-1' },
  { sessionId: 'preview-2', title: '检查长标题与中文输入', provider: 'codex' as const, tags: ['mobile', 'review'], isPinned: true, projectName: 'super-one' },
  { sessionId: 'preview-3', title: 'Audit theme tokens for the light scheme', provider: 'opencode' as const },
  // Past SESSION_REVEAL_STEP so the drawer's "Show more" footer is reviewable.
  { sessionId: 'preview-4', title: 'Wire the terminal resize handshake', provider: 'claude' as const },
  { sessionId: 'preview-5', title: 'Relay ACK buffer GC', provider: 'codex' as const },
  { sessionId: 'preview-6', title: 'Pinch-to-zoom in the image viewer', provider: 'claude' as const },
  { sessionId: 'preview-7', title: 'Android edge-to-edge insets', provider: 'opencode' as const },
]
const previewClient = previewRelayClient(sessions)
// One cache per connection, as in the shell; the preview's connection is this module.
const previewWorkspaceCache = new WorkspaceListCache()
/** Offline fixtures never reach a host, so nothing is ever confirmed applied. */
const previewSessionOp = () => Promise.resolve(false)
const initialMessages: ChatMessage[] = [
  { id: 'user', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Review <superone-miniapp><appname>Board</appname><appid>board</appid></superone-miniapp> and <superone-miniapp><appname>Default app</appname><appid>missing-logo</appid></superone-miniapp> with <superone-desktop-app><name>Editor</name><bundleId>com.example.Editor</bundleId></superone-desktop-app>.' }], providerId: 'claude', createdAt: '2026-09-05T08:00:00Z' },
  { id: 'assistant', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'The native shell now shares one visual language.\n\n- Compact navigation\n- Contextual model selection\n- Keyboard-safe approval sheets\n\n`apps/mobile/src/screens/chat-screen.tsx`' }], providerId: 'claude', createdAt: '2026-09-05T08:00:01Z' },
  { id: 'probe', role: 'assistant', status: 'complete', content: [{ type: 'text', text: '```ts\nexport function add(a: number, b: number): string {\n  // highlight probe\n  return `${a + b}`\n}\n```\n\n```python\ndef add(a: int, b: int) -> str:\n    return f"{a + b}"\n```' }], providerId: 'claude', createdAt: '2026-09-05T08:00:02Z' },
]

/** Offline visual review of production pages; callbacks never contact a desktop. */
export function ShellPreview({ initialPage = 'New session', initialEffort, onClose, onTheme }: { initialPage?: Page; initialEffort?: string; onClose: () => void; onTheme: () => void }) {
  const styles = useMobileStyles()
  const { tokens, setHarness } = useMobileTheme()
  const { t } = useMobileLocale()
  const { width, height, fontScale } = useWindowDimensions()
  const [page, setPage] = useState<Page>(initialPage)
  const [devicesRefreshing, setDevicesRefreshing] = useState(false)
  const [provider, setProvider] = useState<HarnessId>('claude')
  const [acpAgentId, setAcpAgentId] = useState<string | null>(null)
  const chatDraft = useComposerDraft()
  const [mentionRows, setMentionRows] = useState<MentionRow[]>([])
  const [editorError, setEditorError] = useState('')
  /** Both editors feed this, so the fallback is not silently hit-free. */
  const updateMentionHits = (text: string, cursorEnd: number, composing = false) => {
    const query = !composing && extractMentionQuery(text, cursorEnd)
    setMentionRows(query
      ? buildMentionRows(query.query, { remote: previewMentionItems, agentProfiles: previewAgentProfiles, capabilityIds: previewCapabilityIds })
      : [])
  }
  const acceptDraft = (snapshot: MentionEditorSnapshot) => {
    chatDraft.accept(snapshot)
    setSlashDismissed(false)
    updateMentionHits(snapshot.text, snapshot.end, snapshot.composing || snapshot.start !== snapshot.end)
  }
  const changeDraft = (text: string) => {
    chatDraft.changeText(text)
    setSlashDismissed(false)
    updateMentionHits(text, text.length)
  }
  // The composer has two runtimes — the native chip editor and the plain
  // TextInput fallback — and they insert, serialise and send differently.
  // Reviewing only one of them is how a fallback-only regression ships.
  const [nativeEditor, setNativeEditor] = useState(true)
  // The catalog is a fixture here, so the loading and error states have to be
  // reachable on purpose — a healthy preview never produces them.
  const [slashStatus, setSlashStatus] = useState<SlashCatalogStatus>('ready')
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [mode, setMode] = useState('default')
  const [sandbox, setSandbox] = useState<SandboxInfo | null>({ enabled: true, autoAllowBash: false })
  // `/add-dir` and the folder chips open the same page; its two steps are their
  // own preview pages so both are reachable without a live host to browse.
  const [previewDirs, setPreviewDirs] = useState<string[]>(PREVIEW_ADDITIONAL_DIRS)
  const [previewSessionDirs, setPreviewSessionDirs] = useState<string[]>(['/Users/dev/scratch'])
  const [previewAddDirScope, setPreviewAddDirScope] = useState<AddDirScope>('project')
  const [previewAddDirQuery, setPreviewAddDirQuery] = useState('~/Developer/Projects/')
  const [previewCollabTask, setPreviewCollabTaskState] = useState<SessionAgentLaunchProposal | null>(null)
  const setPreviewCollabTask = (launch: SessionAgentLaunchProposal) => { setPreviewCollabTaskState(launch); setPage('Collaboration task') }
  // A slow resolve, so the loading state is visible; the inline fixture task is the brief.
  const previewCollabTaskLoad = useCallback(
    () => new Promise<string>((resolve) => setTimeout(() => resolve(previewCollabTask?.task ?? ''), 600)),
    [previewCollabTask],
  )
  const addDirStep: AddDirStep = page === 'Browse folders'
    ? { kind: 'browse', scope: previewAddDirScope }
    : { kind: 'overview' }
  const previewBrowserMode: FileBrowserMode = page === 'Computer files' || page === 'Go to folder'
    ? { kind: 'computer', name: 'studio-mbp' }
    : { kind: 'project', root: '/workspace/super-one', name: 'super-one' }
  const [drawer, setDrawer] = useState(false)
  const [branch, setBranch] = useState(PREVIEW_GIT_INFO.branch ?? 'main')
  // Runs the real describer over the preview repo, so the header chip cannot
  // drift from the shape the shell actually feeds it.
  const previewSessionGit = describeSessionGit({
    isWorktree: false, worktreePath: null, worktreeRemoved: false, sessionBranch: null,
    projectBranch: branch, projectHead: PREVIEW_GIT_INFO.head ?? null,
    projectDirtyFiles: PREVIEW_GIT_INFO.dirty?.files ?? 0, worktree: PREVIEW_WORKTREE_INFO,
  })
  const [projectPath, setProjectPath] = useState(project.path)
  // Added projects join the list, the same way the shell inserts them, so the
  // landing can name what the picker just cloned.
  const [projectList, setProjectList] = useState(previewProjects)
  const addProject = useAddProject({
    request: previewAddProjectRequest,
    onAdded: (path) => {
      const name = path.split('/').filter(Boolean).pop() ?? path
      setProjectList((current) => current.some((item) => item.path === path)
        ? current : [{ path, name }, ...current])
      setProjectPath(path)
      setPage('New session')
    },
  })
  const [selection, setSelection] = useState<NewSessionWorktreeSelection>({ kind: 'local' })
  const [worktreeDraft, setWorktreeDraft] = useState<NewSessionWorktreeSelection>({ kind: 'local' })
  const [model, setModel] = useState('preview-model')
  const [effort, setEffort] = useState(initialEffort ?? 'medium')
  const catalogs: PreviewCatalog = PREVIEW_CATALOGS[provider] ?? {}
  const [agent, setAgent] = useState<string | null>(null)
  const [sessionMode, setSessionMode] = useState<string | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<Record<string, string>>({})
  const optionParams = optionParamsForModel(provider, previewModels.find((item) => item.id === model), { serviceTier, params: modelParams })
  const setOptionParam = (id: string, value: string) => {
    if (provider === 'codex' && id === 'fast') { setServiceTier(value === 'true' ? 'priority' : null); return }
    setModelParams((current) => ({ ...current, [id]: value }))
  }
  const pickerCatalogs = {
    agents: catalogs.agents, agent: agent ?? catalogs.selectedAgentId ?? null, onAgent: setAgent,
    modes: catalogs.modes, mode: sessionMode ?? catalogs.selectedModeId ?? null,
    modeLabel: catalogs.modeLabel, onMode: setSessionMode,
    optionParams, onOptionParam: setOptionParam,
    providers: catalogs.providers, providerId: providerId ?? catalogs.selectedProviderId ?? null,
    onProvider: setProviderId,
  }
  const catalog = { models: previewModels, efforts: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] }
  const efforts = effortOptionsForModel(provider, catalog, model)
  const chooseModel = (value: string) => { setModel(value); setEffort(resolveSelectedEffort(effortOptionsForModel(provider, catalog, value), effort)) }
  const [writable, setWritable] = useState(false)
  const [terminalTab, setTerminalTab] = useState('dev')
  const previewTerminalTabs = [
    { terminalId: 'dev', title: 'npm run dev', status: 'running' as const },
    { terminalId: 'vim', title: 'vim', status: 'running' as const },
    { terminalId: 'git', title: 'git status', status: 'running' as const },
  ]
  const [messages, setMessages] = useState(initialMessages)
  // Which transient state the document is held in: history paging, pending
  // turn, retry / compaction banners, or the native restore cover.
  const [transcript, setTranscript] = useState<TranscriptState>('live')
  const web = useRef<WebView>(null)
  const terminal = useRef<WebView>(null)
  const chooseAgent = (option: RemoteHarnessOption) => {
    const value = option.provider
    setAcpAgentId(option.acpAgentId)
    setProvider(value); setHarness(value); setMode(HARNESS_LAUNCH_OPTIONS[value].permissionModes.includes('default') ? 'default' : HARNESS_LAUNCH_OPTIONS[value].permissionModes[0]!) }
  const paintChat = () => {
    injectHostMessage(web, mobileWebViewTheme(tokens))
    injectHostMessage(web, { type: 'setViewport', fontScale, locale: 'en' })
    injectHostMessage(web, { type: 'hydrate', ...transcriptProjection(transcript, messages), mentionArtwork: dynamicMentionArtworkSnapshot() })
  }
  useEffect(() => { paintChat(); injectHostMessage(terminal, mobileWebViewTheme(tokens)) }, [tokens, fontScale, messages, transcript])
  /** The document's history requests, answered (slowly, or not at all) per transcript state. */
  const onChatMessage = (raw: string) => {
    const message = JSON.parse(raw)
    if (message.type === 'ready') paintChat()
    if (message.type !== 'requestNative') return
    answerTranscriptRequest(transcript, message.action, message.payload)
      .then((result) => injectHostMessage(web, { type: 'nativeActionResult', requestId: message.requestId, result }))
      .catch((error: Error) => injectHostMessage(web, { type: 'nativeActionResult', requestId: message.requestId, error: error.message }))
  }
  const send = useComposerSend(chatDraft.editorRef, page, () => {
    const captured = chatDraft.capture()
    if (!captured.text.trim() && !attachments.length) return
    setMessages((current) => [...current, { ...initialMessages[0], id: `preview-${current.length}`, content: [{ type: 'text', text: captured.text }], attachments }])
    chatDraft.clearSent(captured.revision); setAttachments([]); setPage('Chat')
  }, (message) => Alert.alert('Could not send', message))
  const chat = page === 'New session' || page === 'Chat' || page === 'Workspace'
  // Standalone galleries share the catch-all 'files' route but draw themselves.
  const gallery = page === 'Drafts' || page === 'Icons' || page === 'Git indicators' || page === 'Session status' || page === 'Composer suggestions' || page === 'Chip editor' || page === 'LAN browser' || page === 'Loading states'
  const route = chat ? 'chat' : page === 'Project' ? 'project-picker' : page === 'Add project' ? 'add-project' : page === 'Worktree' ? 'worktree' : page === 'Branch' ? 'branch' : page === 'Additional folders' || page === 'Browse folders' ? 'add-dir' : page === 'Collaboration request' ? 'collab-request' : page === 'Collaboration task' ? 'collab-task' : page === 'Devices' || page === 'Pairing' ? 'pair' : page === 'Terminal' ? 'terminal' : page === 'Session search' ? 'session-search' : page === 'Settings' ? 'settings' : 'files'
  /** One workspace, two mounts: the drawer below and the sidebar in the row. */
  const previewWorkspace = {
    client: previewClient, projects: previewProjects, activeProject: project,
    activeSessionId: 'preview-1', sessions, cache: previewWorkspaceCache, listRevision: 0,
    onNewSession: () => setPage('New session'), onOpenSession: () => setPage('Chat'),
    onPinSession: previewSessionOp, onArchiveSession: previewSessionOp, onDeleteSession: previewSessionOp,
    onSearch: () => setPage('Session search'), onAddProject: () => setPage('Add project'),
  }
  const tabletSidebar = shouldUseTabletMultiPane(width, height, route, true)
  return <SafeAreaView style={styles.root}>
    <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
      <Button variant="ghost" label="Close preview" onPress={onClose} />
      <View style={styles.flex}><SelectionField compact label="Preview page" value={page} options={pages.map((value) => ({ value, label: value }))} onChange={(value) => setPage(value as Page)} /></View>
      <Button variant="ghost" label={tokens.scheme === 'dark' ? 'Light' : 'Dark'} onPress={onTheme} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: tokens.colors.surface, paddingRight: 8 }}>
      <Text style={[styles.meta, { flex: 1 }]}>Offline preview · {Math.round(width)} px · font {fontScale.toFixed(2)}</Text>
      {chat ? <Button variant="ghost" label={nativeEditor ? 'Editor: native' : 'Editor: fallback'}
        onPress={() => setNativeEditor((value) => !value)} /> : null}
      {chat ? <Button variant="ghost" label={`Catalog: ${slashStatus}`}
        onPress={() => setSlashStatus((value) => value === 'ready' ? 'loading' : value === 'loading' ? 'error' : 'ready')} /> : null}
    </View>
    {page === 'Chat' ? <View style={{ paddingHorizontal: 8, backgroundColor: tokens.colors.surface }}>
      <SelectionField compact label="Transcript" value={transcript}
        options={transcriptStates.map((value) => ({ value, label: value }))} onChange={(value) => setTranscript(value as TranscriptState)} />
    </View> : null}
    <MobileKeyboardFrame>
      <View style={styles.contentRow}>
        {tabletSidebar ? <WorkspaceSidebar {...previewWorkspace} deviceName="Preview desktop" deviceStatus="connectedLan" onDisconnect={() => setPage('Devices')} onOpenSettings={() => setPage('Settings')} /> : null}
        <View style={styles.mainPane}>
      <MobileHeader route={route} title={page === 'Add project' ? addProject.title : page === 'Project' ? 'Projects' : page === 'Terminal' ? (previewTerminalTabs.find((tab) => tab.terminalId === terminalTab)?.title ?? 'Terminal') : route === 'files' ? previewBrowserMode.name : route === 'collab-request' || route === 'collab-task' ? mobileHeaderTitle(route, undefined, '', '', t) : page} subtitle="super-one" provider={provider} hasSession={page === 'Chat'} launchCount={page === 'Collaboration request' ? 3 : undefined} deviceStatus="connectedLan" sidebarVisible={tabletSidebar} git={page === 'Chat' ? previewSessionGit : null} terminal={page === 'Terminal' ? {
          tabs: previewTerminalTabs,
          activeId: terminalTab,
          onSelect: setTerminalTab,
          onCreate: () => {},
          onClose: () => {},
        } : undefined} onOpenBranch={() => setPage('Branch')} onBack={() => {
          if (page === 'Add project' && addProject.canGoBack) addProject.goBack()
          else if (page === 'Add project') setPage('Project')
          // Browsing unwinds to the overview before the page itself leaves,
          // which is the step the shipping `back` walks too.
          else if (page === 'Browse folders') setPage('Additional folders')
          else if (page === 'Collaboration task') setPage('Collaboration request')
          else setPage('New session')
        }} onSwitchSession={() => setDrawer(true)} onOpenTerminal={() => setPage('Terminal')} onOpenFiles={() => setPage('Files')}
          files={route === 'files' ? { kind: previewBrowserMode.kind,
            finderOpen: page === 'File search' || page === 'Go to folder',
            onToggleFinder: () => setPage(page === 'File search' ? 'Files'
              : page === 'Go to folder' ? 'Computer files'
                : previewBrowserMode.kind === 'computer' ? 'Go to folder' : 'File search'),
            onUploadFile: () => {},
            onNewFolder: () => {},
          } : undefined}
        onConfirm={page === 'Worktree' ? () => { setSelection(worktreeDraft); setPage('New session') }
          : page === 'Add project' && addProject.confirmLabel ? addProject.confirm : undefined}
        confirmLabel={page === 'Add project' ? addProject.confirmLabel ?? undefined : undefined}
        onAddProject={page === 'Project' ? () => setPage('Add project') : undefined}
        confirmDisabled={page === 'Add project' ? addProject.busy
          : !!worktreeSelectionError(worktreeDraft, PREVIEW_BRANCHES, PREVIEW_CHECKED_OUT)} />
        <StatusBanner message={editorError} onDismiss={() => setEditorError('')} />
        <View style={isFullBleedScreen(route) ? styles.flex : styles.page}>
          {chat ? <ChatScreen provider={provider} onEdgeSwipe={() => setDrawer(true)} loadingConversation={page === 'Chat' && transcript === 'restoring'} landing={page === 'New session' ? {
              provider, harnessOptions: PREVIEW_HARNESS_OPTIONS,
              activeHarnessKey: suggestionHarnessKey(provider, acpAgentId), onHarness: chooseAgent,
              projectName: projectList.find((item) => item.path === projectPath)?.name,
              onOpenProject: () => setPage('Project'),
              worktreeSelection: selection, worktreeInfo: PREVIEW_WORKTREE_INFO,
              branch, dirtyFiles: PREVIEW_GIT_INFO.dirty?.files,
              onWorktree: () => { setWorktreeDraft(selection); setPage('Worktree') },
              onBranch: () => setPage('Branch'),
            } : undefined}
            selection={{ ...pickerCatalogs, model, models: previewModels, effort, efforts, onModel: chooseModel, onEffort: setEffort }}
            webRef={web} permissionModes={['default', 'acceptEdits', 'plan']} permissionMode={mode} slashHits={slashDismissed ? [] : filterSlashCommands(chatDraft.draft, previewSlashCatalog, provider)} slashCatalogStatus={!slashDismissed && chatDraft.draft.startsWith('/') ? slashStatus : 'ready'} mentionRows={mentionRows} attachments={attachments} projectDirs={page === 'New session' ? previewDirs : []} sessionDirs={page === 'New session' ? previewSessionDirs : []} onManageDirectories={() => setPage('Additional folders')} queuedMessages={[]}
todos={page === 'Chat' ? previewTodos : {}} draft={chatDraft.draft} streaming={page === 'Chat'}
            sandboxInfo={sandbox} contextTokens={82_400} contextWindow={200_000} totalCostUsd={0.4213}
            onWebMessage={onChatMessage} onWebProcessError={() => {}} onPermissionMode={setMode}
            onSandboxMode={(next) => setSandbox(sandboxInfoFromMode(next))} onSlash={(command) => {
              // Mirror the shipping handler: with the fallback editor mounted there
              // is no controller to call, and dropping the else branch leaves the
              // draft untouched and the overlay stuck open. Only the command line
              // is rewritten, so later lines and their chips survive.
              const line = `/${command} `
              if (chatDraft.editorRef.current) chatDraft.editorRef.current.replaceFirstLine(line)
              else changeDraft(replaceFirstLine(chatDraft.draft, line))
              setSlashDismissed(true)
            }} onSlashDismiss={() => setSlashDismissed(true)} onMention={(item) => {
              if (nativeEditor) { chatDraft.editorRef.current?.insertMention(item); return }
              // Fallback inserts plain `@path` text — deliberately not the typed
              // chip the native editor produces. The difference is the point.
              const query = extractMentionQuery(chatDraft.draft, chatDraft.draft.length)
              if (query) changeDraft(insertMention(chatDraft.draft, query, item))
            }}
            onRemoveAttachment={(item) => setAttachments((current) => current.filter((entry) => entry !== item))}
            onAttachmentMenu={() => setAttachments([{ id: 'pdf', name: 'mobile-design-review.pdf', mimeType: 'application/pdf', base64: '' }])}
            onAttachImage={() => setAttachments((current) => [...current, { id: 'img', name: 'shot.png', mimeType: 'image/png', base64: '' }])}
            onAttachPdf={() => setAttachments((current) => [...current, { id: 'pdf', name: 'mobile-design-review.pdf', mimeType: 'application/pdf', base64: '' }])}
            onInsertSnippet={(snippet) => changeDraft(`${chatDraft.draft}${snippet}`)}
            nativeDraft={nativeEditor ? { controller: chatDraft.editorRef, document: chatDraft.document.current, generation: chatDraft.generation, onChange: acceptDraft, onError: setEditorError } : undefined}
            onDraft={changeDraft} onSubmitFromKeyboard={send} onSend={send} onStop={() => setPage('New session')} /> : null}
          {page === 'Devices' || page === 'Pairing' ? <PairingsScreen scannerOpen={false} paste="" lan=""
            code={page === 'Pairing' ? '123456' : null}
            pairings={previewDevices.map((item) => item.pairing)}
            statusOf={(item) => previewDevices.find((row) => row.pairing.id === item.id)?.status ?? 'offline'}
            reconnect={{ attempting: false, waiting: true, delayMs: 16_000, nextAtMs: Date.now() + 9_000 }}
            activePairingId="desk-retry" connectingPairingId={null}
            refreshing={devicesRefreshing} onRefresh={() => setDevicesRefreshing((value) => !value)}
            onBarcodeScanned={() => {}} onCancelScanner={() => {}} onPasteChange={() => {}} onLanChange={() => {}}
            onPair={() => {}} onCancelPairing={() => setPage('Devices')} onOpenScanner={() => setPage('Pairing')} onConnect={() => {}} onRename={() => {}} onForget={() => {}} /> : null}
          {page === 'Session search' ? <SessionSearchScreen client={previewClient} onOpenSession={() => setPage('Chat')} onCancel={() => setPage('Chat')} /> : null}
          {page === 'Settings' ? <AppSettingsScreen update={{ version: '1.0.0', buildCode: 42 }} /> : null}
          {page === 'Update' ? <UpdatePromptGallery /> : null}
          {page === 'Project' ? <ProjectPickerScreen projects={projectList} activePath={projectPath}
            onSelect={(item) => { setProjectPath(item.path); setPage('New session') }} /> : null}
          {page === 'Add project' ? <AddProjectScreen flow={addProject} /> : null}
          {page === 'Additional folders' || page === 'Browse folders' ? <AddDirScreen
            step={addDirStep} projectDirs={previewDirs} sessionDirs={previewSessionDirs}
            entries={PREVIEW_FOLDER_ENTRIES} query={previewAddDirQuery}
            loading={false} busy={false}
            error={previewAddDirQuery.endsWith('/nope') ? 'No folder at that path' : ''}
            onQuery={setPreviewAddDirQuery}
            onEnter={(name) => setPreviewAddDirQuery((current) => appendBrowsePathSegment(current, name))}
            onBrowse={(scope) => { setPreviewAddDirScope(scope); setPage('Browse folders') }}
            onRemove={(dir, scope) => (scope === 'session' ? setPreviewSessionDirs : setPreviewDirs)(
              (current) => current.filter((entry) => entry !== dir))} /> : null}
          {page === 'Collaboration request' ? <CollabRequestScreen
            payload={permissionExamples.session_agents_confirm.sessionAgentsConfirm}
            onApprove={() => setPage('Chat')} onReject={() => setPage('Chat')}
            onOpenTask={(launch) => setPreviewCollabTask(launch)} /> : null}
          {page === 'Collaboration task' ? <CollabTaskScreen load={previewCollabTaskLoad} /> : null}
          {page === 'Worktree' ? <WorktreeScreen selection={worktreeDraft} onSelectionChange={setWorktreeDraft}
            gitInfo={{ ...PREVIEW_GIT_INFO, branch }} worktreeInfo={PREVIEW_WORKTREE_INFO}
            worktreeDirty={PREVIEW_WORKTREE_DIRTY} branches={PREVIEW_BRANCHES}
            checkedOutBranches={PREVIEW_CHECKED_OUT} /> : null}
          {page === 'Branch' ? <BranchScreen branches={PREVIEW_BRANCHES} currentBranch={branch}
            dirty={PREVIEW_GIT_INFO.dirty}
            onSwitch={async (next) => { await previewSwitchBranch(next); setBranch(next) }}
            onCreate={async (next) => { setBranch(next) }}
            onDone={() => setPage('New session')} /> : null}
          {page === 'File preview' ? <FilePreviewGallery /> : null}
          {page === 'Icons' ? <IconGallery /> : null}
          {page === 'Drafts' ? <DraftsPreview /> : null}
          {page === 'Git indicators' ? <GitIndicatorGallery
            onOpenWorktree={(next) => { setWorktreeDraft(next); setPage('Worktree') }}
            onOpenBranch={() => setPage('Branch')} /> : null}
          {page === 'Session status' ? <SessionStatusGallery onOpenBranch={() => setPage('Branch')} /> : null}
          {page === 'LAN browser' ? <LanBrowserPreview /> : null}
          {page === 'Composer suggestions' ? <ComposerSuggestionsGallery /> : null}
          {page === 'Loading states' ? <LoadingStateGallery /> : null}
          {page === 'Chip editor' ? <MentionEditorPreview /> : null}
          {route === 'files' && !gallery ? (page === 'File search' ? <FileFinderView
            query="chat" busy={false} onQuery={() => {}}
            finder={{ kind: 'search', root: '/workspace/super-one', results: PREVIEW_SEARCH_RESULTS, searched: true,
              onOpenDirectory: () => {}, onOpenFile: () => {} }} />
            : page === 'Go to folder' ? <FileFinderView
              query="/Users/dev/Dev" busy={false} onQuery={() => {}}
              finder={{ kind: 'goto', suggestions: PREVIEW_COMPLETIONS, onComplete: () => {}, onSubmit: () => {} }} />
            : <FilesScreen
              mode={previewBrowserMode}
              path={page === 'Computer files' ? '/Users/dev/Developer' : '/workspace/super-one/apps/mobile/src'}
              items={page === 'Files' ? PREVIEW_PROJECT_FILES : page === 'Computer files' ? PREVIEW_COMPUTER_FILES : []}
              gitTones={PREVIEW_GIT_TONES}
              onRefresh={() => {}}
              error={page === 'Folder error' ? 'Could not read this folder. Check the desktop connection.' : undefined}
              onOpenDirectory={() => setPage('Empty folder')} onOpenFile={() => {}} />) : null}
          {page === 'Terminal' ? <TerminalScreen webRef={terminal} writable={writable} onClaim={() => { setWritable(true); injectHostMessage(terminal, { kind: 'meta', writableByMe: true }) }} onKey={(data) => { if (writable) injectHostMessage(terminal, { kind: 'append', data }) }} onWebMessage={(raw) => {
            const message = JSON.parse(raw)
            if (message.type === 'terminalInput' && writable) injectHostMessage(terminal, { kind: 'append', data: message.data })
            if (message.type !== 'terminalReady') return
            injectHostMessage(terminal, mobileWebViewTheme(tokens))
            injectHostMessage(terminal, { kind: 'replace', ansi: '$ pwd\r\n/workspace/super-one\r\n$ ', snapshot: { writableByMe: writable } })
          }} /> : null}
        </View>
        </View>
      </View>
    </MobileKeyboardFrame>
    <WorkspaceDrawer {...previewWorkspace} visible={drawer || page === 'Workspace'} onDismiss={() => { setDrawer(false); if (page === 'Workspace') setPage('Chat') }} deviceName="Preview desktop" deviceStatus="connectedLan" onDisconnect={() => setPage('Devices')} onOpenAppSettings={() => setPage('Settings')} />
  </SafeAreaView>
}
