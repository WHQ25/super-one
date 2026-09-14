import { createRef, type ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { WebView } from 'react-native-webview'
import { MobileThemeProvider } from '../theme/context'
import { ChatScreen } from './chat-screen'
import type { NewSessionLandingProps } from './new-session-landing'

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
  queuedMessages: [],
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

export const QueuedWhileStreaming = {
  args: {
    streaming: true,
    canSteer: true,
    canSteerSoon: true,
    queuedMessages: [{
      id: 'q1', role: 'user' as const, status: 'complete' as const,
      content: [{ type: 'text' as const, text: 'fix the queue first' }],
      createdAt: '', providerId: 'local',
    }],
    draft: 'another thought',
  },
  name: 'Streaming · queued user messages',
}
