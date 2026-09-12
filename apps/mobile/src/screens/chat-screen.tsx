import type { NativeComposerBinding } from '../ui/native-composer-input'
import type { ComposerCursor } from '../composer-cursor'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { EdgeSwipeArea } from '../ui/edge-swipe'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import type { ChatMessage, HarnessId, ImageAttachment, SandboxInfo, SandboxSupportLevel, SandboxMode, TodoItem } from '@superone/shared/agent-types'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import type { MentionItem } from '../mentions'
import type { MentionRow } from '../mention-rows'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import type { ReactNode } from 'react'
import { ChatComposer, type ComposerSelection } from './chat-composer'
import { QueuedMessages } from '../ui/queued-messages'
import { NewSessionLanding, type NewSessionLandingProps } from './new-session-landing'
import { chatViewPrePaintScript, hostMessageIsReady } from './chat-webview-boot'
import { injectHostMessage } from '../native-actions'
import { TodoPanel } from '../ui/todo-panel'
import { useMobileLocale } from '../i18n/context'

const CHAT_SOURCE = { html: CHAT_VIEW_HTML }

/**
 * The landing and restore covers sit over the WebView. `elevation` is what
 * puts them above it on Android, but elevation also casts a Material shadow,
 * and the cover's bottom edge would drop a grey band onto the composer in light
 * mode. A transparent shadow colour keeps the ordering and loses the band.
 */
const coverStyle = { zIndex: 1, elevation: 4, shadowColor: 'transparent' } as const

export function ChatScreen(props: {
  nativeDraft?: NativeComposerBinding
  provider: HarnessId
  landing?: NewSessionLandingProps
  /**
   * Switching to an existing session: drop the previous transcript immediately
   * rather than leaving it on screen until restore finishes.
   */
  loadingConversation?: boolean
  selection?: ComposerSelection
  webRef: RefObject<WebView | null>
  permissionModes: string[]
  permissionMode: string
  sandboxInfo: SandboxInfo | null
  /** Host platform sandbox capability, reported by the harness catalog. */
  sandboxSupport?: SandboxSupportLevel
  contextTokens: number
  contextWindow: number | null
  totalCostUsd: number
  slashHits: MatchedSlashCommand[]
  slashCatalogStatus: SlashCatalogStatus
  mentionRows: MentionRow[]
  /** End-of-turn follow-ups; the composer renders every one as a tappable chip. */
  promptSuggestions?: string[]
  onPromptSuggestion?: (suggestion: string) => void
  attachments: ImageAttachment[]
  projectDirs: string[]
  sessionDirs: string[]
  queuedMessages: ChatMessage[]
  todos: Record<string, TodoItem>
  onCursorChange?: (selection: ComposerCursor) => void
  requestedCursor?: ComposerCursor
  mentionSearch?: MentionSearchState
  onMentionRetry?: () => void
  onMentionLoadMore?: () => void
  /** Opens the additional-folders panel — the chip row and `/add-dir` share it. */
  onManageDirectories: () => void
  /**
   * The one overlay the composer may show — a command's panel. Set means it
   * takes the slot from the slash and mention lists rather than stacking on
   * them; see `ChatComposer`.
   */
  overlay?: ReactNode
  /**
   * Dragging in from the left edge of the transcript. Chat is the stack root's
   * only child, so the native back gesture is turned off here — this is what
   * takes its place, and it opens the workspace rather than leaving the device.
   */
  onEdgeSwipe?: () => void
  mentionQuery?: string | null
  mentionGroupLabels?: Partial<Record<string, string>>
  draft: string
  streaming: boolean
  onWebMessage: (raw: string) => void
  onWebProcessError: (message: string) => void
  onPermissionMode: (mode: string) => void
  onSandboxMode: (mode: SandboxMode) => void
  onSlash: (command: string) => void
  onSlashDismiss: () => void
  onMention: (item: MentionItem) => void
  onRemoveAttachment: (attachment: ImageAttachment) => void
  onAttachmentMenu: () => void
  onAttachImage: () => void
  onAttachPdf: () => void
  onInsertSnippet: (snippet: string) => void
  onDraft: (value: string) => void
  onSubmitFromKeyboard: () => void
  onSend: () => void
  onStop: () => void
  onSteer?: () => void
  onSteerSoon?: () => void
  canSteer?: boolean
  canSteerSoon?: boolean
  onEditQueued?: (messageId: string) => void
  onSteerQueued?: (messageId: string) => void
  onSteerQueuedSoon?: (messageId: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  // The WebView stays mounted (opacity 0) under the landing and under restore
  // so the first send and a session switch both reveal an already-themed
  // document instead of remounting onto WKWebView's white default.
  const showLanding = Boolean(props.landing) && !props.loadingConversation
  const [rendererReady, setRendererReady] = useState(false)
  const [coverUntilReady, setCoverUntilReady] = useState(false)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    if (props.loadingConversation) {
      setCoverUntilReady(true)
      setHold(true)
      return
    }
    const timer = setTimeout(() => setHold(false), 64)
    return () => clearTimeout(timer)
  }, [props.loadingConversation])
  useEffect(() => {
    if (!showLanding) return
    injectHostMessage(props.webRef, { type: 'reset' })
  }, [showLanding, props.webRef])
  // One composer stays mounted across sessions, so the previous first
  // responder would otherwise keep the keyboard up after a switch. The first
  // send (landing → live transcript) is not a switch: both of these are then
  // false, and the keyboard stays for the next message.
  useEffect(() => {
    if (showLanding || props.loadingConversation) Keyboard.dismiss()
  }, [showLanding, props.loadingConversation])
  const coveringRestore = props.loadingConversation || hold || (coverUntilReady && !rendererReady)
  const hideRenderer = coveringRestore || showLanding || !rendererReady
  // Captured on first mount: changing `injectedJavaScriptBeforeContentLoaded`
  // remounts WKWebView and would flash the white default we are covering.
  const prePaint = useRef(chatViewPrePaintScript(tokens.colors.background, tokens.scheme)).current
  return (
    <View style={styles.flex}>
      {/* The edge strip is scoped to the scrolling half of the screen: over the
          composer it would swallow taps that land on the input's own padding. */}
      <View style={[styles.flex, { backgroundColor: tokens.colors.background }]}>
      <View collapsable={false} pointerEvents={hideRenderer ? 'none' : 'auto'} style={[styles.flex, { backgroundColor: tokens.colors.background, opacity: hideRenderer ? 0 : 1 }]}>
        <WebView
        testID="chat-webview"
        ref={props.webRef}
        originWhitelist={['*']}
        source={CHAT_SOURCE}
        injectedJavaScriptBeforeContentLoaded={prePaint}
        style={[styles.flex, { backgroundColor: tokens.colors.background }]}
        containerStyle={{ backgroundColor: tokens.colors.background }}
        onMessage={(event) => {
          const raw = event.nativeEvent.data
          props.onWebMessage(raw)
          if (hostMessageIsReady(raw)) setRendererReady(true)
        }}
        onContentProcessDidTerminate={() => {
          setRendererReady(false)
          setCoverUntilReady(true)
          setHold(true)
          props.onWebProcessError('content process terminated')
        }}
        onRenderProcessGone={() => {
          setRendererReady(false)
          setCoverUntilReady(true)
          setHold(true)
          props.onWebProcessError('render process terminated')
        }}
      />
      </View>
      {coveringRestore ? (
        <View testID="conversation-loading" collapsable={false} style={[StyleSheet.absoluteFillObject, styles.emptyState, coverStyle, { backgroundColor: tokens.colors.background }]}>
          <ActivityIndicator color={tokens.colors.mutedForeground} />
          <Text style={styles.emptyBody}>{t('Loading…')}</Text>
        </View>
      ) : showLanding && props.landing ? (
        // The renderer stays mounted at opacity 0 and still occupies flex
        // space, so a sibling landing would sit just above the composer.
        <View testID="new-session-landing" collapsable={false} style={[StyleSheet.absoluteFillObject, coverStyle, { backgroundColor: tokens.colors.background }]}>
          <NewSessionLanding {...props.landing} />
        </View>
      ) : null}
      {props.onEdgeSwipe ? <EdgeSwipeArea onSwipe={props.onEdgeSwipe} /> : null}
      </View>
      {!props.loadingConversation ? <TodoPanel todos={props.todos} /> : null}
      {!props.loadingConversation && props.queuedMessages.length ? (
        <QueuedMessages
          messages={props.queuedMessages}
          canSteer={!!props.canSteer && props.streaming}
          canSteerSoon={!!props.canSteerSoon && props.streaming}
          onEdit={(id) => props.onEditQueued?.(id)}
          onSteer={(id) => props.onSteerQueued?.(id)}
          onSteerSoon={(id) => props.onSteerQueuedSoon?.(id)}
        />
      ) : null}
      <ChatComposer {...props} />
    </View>
  )
}
