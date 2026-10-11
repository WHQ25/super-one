import { createRef, type ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { WebView } from 'react-native-webview'
import { MobileThemeProvider } from '../theme/context'
import { ChatScreen } from './chat-screen'
import type { NewSessionLandingProps } from './new-session-landing'
import { MobileVoiceEntry, MobileVoiceControls, MobileVoiceReturnEntry } from '../voice/mobile-voice-controls'
import type { MobileVoiceState } from '../voice/voice-service'

const noop = () => {}

const landing: NewSessionLandingProps = {
  provider: 'claude',
  harnessOptions: [{ key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude Code' }],
  activeHarnessKey: 'claude',
  onHarness: noop,
  projectName: 'super-one',
  onOpenProject: noop,
  worktreeSelection: { kind: 'local' },
  onWorktree: noop,
  onBranch: noop,
}

const base: ComponentProps<typeof ChatScreen> = {
  provider: 'claude',
  webRef: createRef<WebView>(),
  permissionModes: ['default'],
  permissionMode: 'default',
  sandboxInfo: null,
  contextTokens: 0,
  contextWindow: 200_000,
  totalCostUsd: 0,
  slashHits: [],
  slashCatalogStatus: 'ready',
  mentionRows: [],
  attachments: [],
  projectDirs: [],
  sessionDirs: [],
  todos: {},
  onManageDirectories: noop,
  draft: '',
  streaming: false,
  onWebMessage: noop,
  onWebProcessError: noop,
  onPermissionMode: noop,
  onSandboxMode: noop,
  onSlash: noop,
  onSlashDismiss: noop,
  onMention: noop,
  onRemoveAttachment: noop,
  onAttachmentMenu: noop,
  onAttachImage: noop,
  onAttachPdf: noop,
  onInsertSnippet: noop,
  onDraft: noop,
  onSubmitFromKeyboard: noop,
  onSend: noop,
  onStop: noop,
}

function Preview({ frameHeight = 640, ...props }: ComponentProps<typeof ChatScreen> & { frameHeight?: number }) {
  return (
    <MobileThemeProvider>
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}>
        <View style={{ width: 390, height: frameHeight }}>
          <ChatScreen {...props} />
        </View>
      </SafeAreaProvider>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/ChatScreen',
  component: ChatScreen,
  render: Preview,
  args: base,
}

export const LiveSession = {
  name: 'Live session · no loading copy',
}

export const Landing = {
  args: { landing },
  name: 'New session · landing',
}

export const CodexVoiceLanding = {
  name: 'Codex new session · voice entry before first message',
  args: {
    provider: 'codex',
    landing: { ...landing, provider: 'codex', activeHarnessKey: 'codex',
      harnessOptions: [{ key: 'codex', provider: 'codex', acpAgentId: null, label: 'Codex' }] },
    voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={noop} />,
  },
}

function voiceComposer(patch: Partial<MobileVoiceState> = {}) {
  const state: MobileVoiceState = { phase: 'active', target: { projectPath: '/repo', sessionId: 'voice-task', title: 'Voice conversation' }, inputMuted: false, paused: false, pauseReason: null, resuming: false, error: null, ...patch }
  return <MobileVoiceControls state={state} onStop={noop} onInputMute={noop} onPlayback={noop} onRetry={noop} onSettings={noop} />
}

export const VoiceConnected = { name: 'Voice · bottom composer', args: { provider: 'codex', voiceComposer: voiceComposer() } }
export const VoiceBackingThread = { name: 'Voice · backing Codex view with compact return', args: { provider: 'codex', draft: 'Steer the running task', voiceEntry: <MobileVoiceReturnEntry onReturn={noop} /> } }
export const OtherSessionWithVoice = { name: 'Other session · compact voice return, one composer', args: { provider: 'claude', draft: 'Another task', voiceEntry: <MobileVoiceReturnEntry onReturn={noop} /> } }
export const VoiceConnecting = { name: 'Voice · connecting', args: { provider: 'codex', voiceComposer: voiceComposer({ phase: 'starting' }) } }
export const VoicePermissionDenied = { name: 'Voice · microphone denied', args: { provider: 'codex', voiceComposer: voiceComposer({ phase: 'denied', error: 'Microphone access denied. Enable it in Settings.' }) } }
export const VoiceNarrowLandscape = { name: 'Voice · short landscape', args: { provider: 'codex', voiceComposer: voiceComposer() }, render: (props: ComponentProps<typeof ChatScreen>) => <Preview {...props} frameHeight={320} /> }

export const LandingKeyboardUp = {
  args: { landing },
  name: 'New session · landing with keyboard',
  render: (props: ComponentProps<typeof ChatScreen>) => <Preview {...props} frameHeight={320} />,
}

export const RestoringSession = {
  args: { loadingConversation: true },
  name: 'Session switch · cover over the renderer, no white flash',
}

export const CachedSessionRevalidating = {
  args: { loadingConversation: false, draft: 'Continue from the saved conversation' },
  name: 'Cached session · renderer uncovered while the host revalidates',
}

/** Queued messages themselves are drawn by the chat document; see `PortableQueuedMessages`. */
export const SteerWhileStreaming = {
  args: {
    streaming: true,
    canSteer: true,
    canSteerSoon: true,
    draft: 'another thought',
  },
  name: 'Streaming · steer from the composer',
}
