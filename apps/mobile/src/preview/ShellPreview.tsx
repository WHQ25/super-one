import { useComposerDraft } from '../navigation/use-composer-draft'
import { extractMentionQuery, type MentionItem } from '../mentions'
import type { MentionEditorSnapshot } from '../mention-editor-state'
import { MentionEditorPreview } from './MentionEditorPreview'
import { useEffect, useRef, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { WebView } from 'react-native-webview'
import type { ChatMessage, HarnessId, ImageAttachment, ModelOption } from '@superone/shared/agent-types'
import { MobileHeader } from '../navigation/mobile-header'
import { MobileKeyboardFrame } from '../navigation/mobile-keyboard-frame'
import { WorkspaceDrawer } from '../navigation/workspace-drawer'
import { TabletSessionSidebar } from '../navigation/tablet-session-sidebar'
import { ChatScreen } from '../screens/chat-screen'
import { FilesScreen } from '../screens/files-screen'
import { PairingsScreen } from '../screens/pairings-screen'
import { ProjectsScreen } from '../screens/projects-screen'
import { SessionsScreen } from '../screens/sessions-screen'
import { SettingsScreen, type ProjectSettingsProps } from '../screens/settings-screen'
import { TerminalScreen } from '../screens/terminal-screen'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { injectHostMessage } from '../native-actions'
import { Button, SelectionField, Sheet } from '../ui'
import { IconGallery } from './IconGallery'
import { effortOptionsForModel, resolveSelectedEffort } from '../model-selection-state'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { shellPreviewPages, type ShellPreviewPage as Page } from './preview-route'

// The tool catalog is its own screen, not a page of this shell — see ToolCatalogPreview.
const pages = shellPreviewPages.filter((page) => page !== 'Tool catalog')
import { dynamicMentionArtworkSnapshot } from '../ui/mention-dynamic-artwork'

const previewModels: ModelOption[] = [
  { id: 'preview-model', name: 'Preview model', description: 'Balanced model · offline fixture', supportedEffortLevels: ['medium', 'high'], supportedReasoningEfforts: [{ value: 'medium', description: 'Balanced reasoning' }, { value: 'high', description: 'Deeper reasoning' }] },
  { id: 'preview-fast', name: 'Preview fast', description: 'Quick replies · offline fixture' },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `preview-catalog-${index + 1}`, name: `Catalog model ${index + 1}`,
    description: 'Extended offline catalog for search, scrolling and large-text checks',
  })),
]
const project = { name: 'super-one', path: '/workspace/super-one' }
const sessions = [
  { sessionId: 'preview-1', title: 'Review the mobile interface and accessibility', provider: 'claude' as const, gitBranch: 'feat/mobile-ui', status: 'streaming' },
  { sessionId: 'preview-2', title: '检查长标题与中文输入', provider: 'codex' as const, tags: ['mobile', 'review'] },
]
const initialMessages: ChatMessage[] = [
  { id: 'user', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Review <superone-miniapp><appname>Board</appname><appid>board</appid></superone-miniapp> and <superone-miniapp><appname>Default app</appname><appid>missing-logo</appid></superone-miniapp> with <superone-desktop-app><name>Editor</name><bundleId>com.example.Editor</bundleId></superone-desktop-app>.' }], providerId: 'claude', createdAt: '2026-09-05T08:00:00Z' },
  { id: 'assistant', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'The native shell now shares one visual language.\n\n- Compact navigation\n- Contextual model selection\n- Keyboard-safe approval sheets\n\n`apps/mobile/src/screens/chat-screen.tsx`' }], providerId: 'claude', createdAt: '2026-09-05T08:00:01Z' },
]

/** Offline visual review of production pages; callbacks never contact a desktop. */
export function ShellPreview({ initialPage = 'New session', onClose, onTheme }: { initialPage?: Page; onClose: () => void; onTheme: () => void }) {
  const styles = useMobileStyles()
  const { tokens, setHarness } = useMobileTheme()
  const { width, fontScale } = useWindowDimensions()
  const [page, setPage] = useState<Page>(initialPage)
  const [provider, setProvider] = useState<HarnessId>('claude')
  const [draft, setDraft] = useState('')
  const chatDraft = useComposerDraft()
  const [mentionHits, setMentionHits] = useState<MentionItem[]>([])
  const [editorError, setEditorError] = useState('')
  const acceptDraft = (snapshot: MentionEditorSnapshot) => {
    chatDraft.accept(snapshot)
    const query = !snapshot.composing && snapshot.start === snapshot.end ? extractMentionQuery(snapshot.text, snapshot.end) : null
    setMentionHits(query ? [{ kind: 'file', path: 'src/中文 file.ts' }, { kind: 'builtin', path: 'debug', label: 'Debug' }].filter((item) => item.path.toLowerCase().includes(query.query.toLowerCase())) : [])
  }
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [mode, setMode] = useState('default')
  const [drawer, setDrawer] = useState(false)
  const [worktree, setWorktree] = useState(false)
  const [selection, setSelection] = useState<ProjectSettingsProps['worktreeSelection']>({ kind: 'local' })
  const [model, setModel] = useState('preview-model')
  const [effort, setEffort] = useState('medium')
  const catalog = { models: previewModels, efforts: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] }
  const efforts = effortOptionsForModel(provider, catalog, model)
  const chooseModel = (value: string) => { setModel(value); setEffort(resolveSelectedEffort(effortOptionsForModel(provider, catalog, value), effort)) }
  const [writable, setWritable] = useState(false)
  const [messages, setMessages] = useState(initialMessages)
  const web = useRef<WebView>(null)
  const terminal = useRef<WebView>(null)
  const chooseAgent = (value: HarnessId) => { setProvider(value); setHarness(value); setMode(HARNESS_LAUNCH_OPTIONS[value].permissionModes.includes('default') ? 'default' : HARNESS_LAUNCH_OPTIONS[value].permissionModes[0]!) }
  const paintChat = () => {
    injectHostMessage(web, mobileWebViewTheme(tokens))
    injectHostMessage(web, { type: 'setViewport', fontScale, locale: 'en' })
    injectHostMessage(web, { type: 'hydrate', messages, mentionArtwork: dynamicMentionArtworkSnapshot() })
  }
  useEffect(() => { paintChat(); injectHostMessage(terminal, mobileWebViewTheme(tokens)) }, [tokens, fontScale, messages])
  const send = () => {
    if (chatDraft.editorRef.current && !chatDraft.editorRef.current.canSubmit()) return
    const captured = chatDraft.capture()
    if (!captured.text.trim() && !attachments.length) return
    setMessages((current) => [...current, { ...initialMessages[0], id: `preview-${current.length}`, content: [{ type: 'text', text: captured.text }], attachments }])
    chatDraft.clearSent(captured.revision); setAttachments([]); setPage('Chat')
  }
  const settings: ProjectSettingsProps = {
    activeSession: page === 'Chat', gitInfo: { branch: 'feat/mobile-ui', dirty: { files: 3, insertions: 28, deletions: 12 } },
    worktreeInfo: null, branches: ['main', 'feat/mobile-ui'], checkedOutBranches: ['main'], worktreeSelection: selection,
    onWorktreeSelectionChange: setSelection, selectedProvider: provider, selectedModel: model, selectedEffort: effort,
    models: previewModels, efforts,
    workspaceDirs: ['/workspace/shared'], additionalDir: '', onAdditionalDirChange: () => {}, onProviderChange: chooseAgent,
    onModelChange: chooseModel, onEffortChange: setEffort, onOpenFiles: () => setPage('Files'), onAddDirectory: () => {}, onRemoveDirectory: () => {},
  }
  const chat = page === 'New session' || page === 'Chat'
  const route = chat ? 'chat' : page === 'Devices' || page === 'Pairing' ? 'pair' : page === 'Terminal' ? 'terminal' : page === 'Settings' ? 'settings' : page === 'Projects' ? 'projects' : page === 'Sessions' ? 'sessions' : 'files'
  return <SafeAreaView style={styles.root}>
    <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
      <Button variant="ghost" label="Close preview" onPress={onClose} />
      <View style={styles.flex}><SelectionField compact label="Preview page" value={page} options={pages.map((value) => ({ value, label: value }))} onChange={(value) => setPage(value as Page)} /></View>
      <Button variant="ghost" label={tokens.scheme === 'dark' ? 'Light' : 'Dark'} onPress={onTheme} />
    </View>
    <Text style={styles.meta}>Offline preview · {Math.round(width)} px · font {fontScale.toFixed(2)}</Text>
    {editorError ? <Text accessibilityRole="alert" style={{ color: tokens.colors.destructive }}>{editorError}</Text> : null}
    <MobileKeyboardFrame>
      <MobileHeader route={route} title={page} subtitle="super-one · feat/mobile-ui" provider={provider} streaming={page === 'Chat'} connectionState="connected" onBack={() => setPage('New session')} onSwitchSession={() => setDrawer(true)} onOpenSettings={() => setPage('Settings')} onOpenTerminal={() => setPage('Terminal')} />
      <View style={styles.contentRow}>
        {width >= 768 && (chat || page === 'Terminal' || page === 'Settings' || route === 'files') ? <TabletSessionSidebar projectName={project.name} sessions={sessions} activeSessionId="preview-1" onOpenSession={() => setPage('Chat')} onCreateSession={() => setPage('New session')} onOpenSettings={() => setPage('Settings')} onArchiveSession={() => {}} onDeleteSession={() => {}} /> : null}
        <View style={chat || page === 'Terminal' ? styles.mainPane : [styles.mainPane, styles.page]}>
          {chat ? <ChatScreen provider={provider} landing={page === 'New session' ? { provider, projectName: project.name, branch: 'feat/mobile-ui', onProvider: chooseAgent, onProject: () => setDrawer(true), onWorktree: () => setWorktree(true) } : undefined}
            selection={{ model, models: settings.models, effort, efforts: settings.efforts, onModel: chooseModel, onEffort: setEffort }}
            webRef={web} permissionModes={['default', 'acceptEdits', 'plan']} permissionMode={mode} slashHits={[]} mentionHits={mentionHits} attachments={attachments} additionalDirectories={[]} queuedMessages={[]} todos={{}} draft={chatDraft.draft} streaming={page === 'Chat'}
            onWebMessage={(raw) => { if (JSON.parse(raw).type === 'ready') paintChat() }} onWebProcessError={() => {}} onPermissionMode={setMode} onSlash={() => {}} onMention={(item) => { chatDraft.editorRef.current?.insertMention(item) }}
            onRemoveAttachment={(item) => setAttachments((current) => current.filter((entry) => entry !== item))} onAttachmentMenu={() => setAttachments([{ id: 'pdf', name: 'mobile-design-review.pdf', mimeType: 'application/pdf', base64: '' }])}
            nativeDraft={{ controller: chatDraft.editorRef, document: chatDraft.document.current, onChange: acceptDraft, onError: setEditorError }}
            onDraft={chatDraft.changeText} onSubmitFromKeyboard={send} onSend={send} onStop={() => setPage('New session')} /> : null}
          {page === 'Devices' || page === 'Pairing' ? <PairingsScreen scannerOpen={false} paste="" lan="" code={page === 'Pairing' ? '123456' : null} pairings={[]} activePairingId={null} connected={false} onBarcodeScanned={() => {}} onCancelScanner={() => {}} onPasteChange={() => {}} onLanChange={() => {}} onPair={() => {}} onOpenScanner={() => setPage('Pairing')} onConnect={() => {}} onRename={() => {}} onForget={() => {}} /> : null}
          {page === 'Projects' ? <ProjectsScreen projects={[project, { name: 'design-system', path: '/workspace/design-system' }]} onOpen={() => setPage('Sessions')} /> : null}
          {page === 'Sessions' ? <SessionsScreen sessions={sessions} onOpenSession={() => setPage('Chat')} onCreateSession={() => setPage('New session')} onArchiveSession={() => {}} onDeleteSession={() => {}} /> : null}
          {page === 'Settings' ? <SettingsScreen {...settings} /> : null}
          {page === 'Icons' ? <IconGallery /> : null}
          {page === 'Chip editor' ? <MentionEditorPreview /> : null}
          {route === 'files' && page !== 'Icons' && page !== 'Chip editor' ? <FilesScreen path="/workspace/super-one/apps/mobile/src" items={page === 'Files' ? [{ name: 'screens', isDirectory: true }, { name: 'chat-screen.tsx', isDirectory: false }, { name: 'mobile-review.png', isDirectory: false }] : []} error={page === 'Folder error' ? 'Could not read this folder. Check the desktop connection.' : undefined} onOpenDirectory={() => setPage('Empty folder')} onOpenFile={() => {}} /> : null}
          {page === 'Terminal' ? <TerminalScreen webRef={terminal} draft={draft} writable={writable} onDraft={setDraft} onClaim={() => { setWritable(true); injectHostMessage(terminal, { kind: 'meta', writableByMe: true }) }} onSubmit={(line) => { injectHostMessage(terminal, { kind: 'append', data: `\r\n$ ${line}\r\n[offline preview]\r\n` }); setDraft('') }} onKey={() => {}} onWebMessage={(raw) => {
            if (JSON.parse(raw).type !== 'terminalReady') return
            injectHostMessage(terminal, mobileWebViewTheme(tokens))
            injectHostMessage(terminal, { kind: 'replace', ansi: '$ pwd\r\n/workspace/super-one\r\n$ ', snapshot: { writableByMe: writable } })
          }} /> : null}
        </View>
      </View>
    </MobileKeyboardFrame>
    <WorkspaceDrawer visible={drawer} onDismiss={() => setDrawer(false)} deviceName="Preview desktop" projects={[project]} activeProject={project} activeSessionId="preview-1" sessions={sessions} loadSessions={async () => sessions} onNewSession={() => setPage('New session')} onOpenSession={() => setPage('Chat')} />
    <Sheet visible={worktree} title="Workspace for new session" onDismiss={() => setWorktree(false)}><SettingsScreen {...settings} section="worktree" /></Sheet>
  </SafeAreaView>
}
