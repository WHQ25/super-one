import type { ContextAttachment } from '@superone/shared/context-attachments'
import type { McpMentionReadResource, McpMentionSearchState } from '@superone/shared/mcp-app-mentions'
import type { NativeComposerBinding } from '../ui/native-composer-input'
import type { ComposerCursor } from '../composer-cursor'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { EdgeSwipeArea } from '../ui/edge-swipe'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import type { ChatMessage, HarnessId, ImageAttachment, SandboxInfo, SandboxSupportLevel, SandboxMode, SessionGoal, TodoItem } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import type { MentionItem } from '../mentions'
import type { MentionRow } from '../mention-rows'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import type { ReactNode } from 'react'
import { ChatComposer, type ComposerSelection } from './chat-composer'
import type { UsageMeterProps } from '../ui/usage-panel'
import { NewSessionLanding, type NewSessionLandingProps } from './new-session-landing'
import { chatViewPrePaintScript, hostMessageIsReady } from './chat-webview-boot'
import { createChatWebViewChannel } from './chat-webview-channel'
import { injectHostMessage } from '../native-actions'
import { TodoPanel } from '../ui/todo-panel'
import { PendingPromptBar } from '../ui/pending-prompt-bar'
import { WorktreeRemovedBanner } from '../ui/worktree-removed-banner'
import type { PendingPrompt } from '../pending-prompt-state'
import { useMobileLocale } from '../i18n/context'
import type { ComposerMode } from '@superone/shared/composer-mode'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { handleScheduledSendAction } from '../scheduled-send-webview'

const CHAT_SOURCE = { html: CHAT_VIEW_HTML }

/**
 * The landing and restore covers sit over the WebView. `elevation` is what
 * puts them above it on Android, but elevation also casts a Material shadow,
 * and the cover's bottom edge would drop a grey band onto the composer in light
 * mode. A transparent shadow colour keeps the ordering and loses the band.
 */
const coverStyle = { zIndex: 1, elevation: 4, shadowColor: 'transparent' } as const

export function ChatScreen(props: {
  scheduledSend?: ScheduledSendControls
  hasConversation?: boolean
  voiceEntry?: ReactNode
  voiceComposer?: ReactNode
  contextAttachments?: ContextAttachment[]
  removingContexts?: string[]
  contextError?: string
  onRemoveContext?: (id: string) => void
  nativeDraft?: NativeComposerBinding
  provider: HarnessId
  landing?: NewSessionLandingProps
  /**
   * Switching to an existing session: drop the previous transcript immediately
   * rather than leaving it on screen until restore finishes.
   */
  loadingConversation?: boolean
  /** The host withdrew the session checkout; replace all composer surfaces with a notice. */
  worktreeRemoved?: boolean
  selection?: ComposerSelection
  webRef: RefObject<WebView | null>
  permissionModes: string[]
  permissionMode: string
  sandboxInfo: SandboxInfo | null
  /** Host platform sandbox capability, reported by the harness catalog. */
  sandboxSupport?: SandboxSupportLevel
  /** Session goal readout; see `ChatComposer` for why there is no goal mode here. */
  goal?: SessionGoal | null
  goalCapability?: GoalCapability | null
  onGoalEdit?: () => void
  onGoalClear?: () => void
  onGoalPause?: () => void
  onGoalResume?: () => void
  onGoalDismiss?: () => void
  contextTokens: number
  contextWindow: number | null
  totalCostUsd: number
  /** The credential's subscription meter; forwarded to the composer's ring. */
  usage?: UsageMeterProps
  slashHits: MatchedSlashCommand[]
  slashCatalogStatus: SlashCatalogStatus
  mentionRows: MentionRow[]
  /** End-of-turn follow-ups; the composer renders every one as a tappable chip. */
  promptSuggestions?: string[]
  onPromptSuggestion?: (suggestion: string) => void
  onPromptSuggestionsDismiss?: () => void
  attachments: ImageAttachment[]
  projectDirs: string[]
  sessionDirs: string[]
  todos: Record<string, TodoItem>
  /** Clears a list once every row has been completed. See `TodoPanel`. */
  onAllTodosCompleted?: () => void
  /** Pins the composer's phone action bar; see `ChatComposer`. */
  focused?: boolean
  /** Prompts put away with an outside tap; each waits as a strip above the todos. */
  collapsedPrompts?: PendingPrompt[]
  onExpandPrompt?: (requestId: string) => void
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
  /**
   * A fullscreen MCP App View has the screen: the composer and the panels stacked on it
   * are hidden until the header's toggle brings them back. Collapsed prompts stay, since
   * they wait on an answer.
   */
  composerHidden?: boolean
  /** The chat document's question card stands in for the composer, as desktop's decision composer does. */
  questionDocked?: boolean
  /** A host input request owns the composer slot while the native editor keeps its draft. */
  inputComposer?: ReactNode
  mentionQuery?: string | null
  mentionGroupLabels?: Partial<Record<string, string>>
  mcpMentions?: McpMentionSearchState
  previewMcpMention?: (value: string) => Promise<McpMentionReadResource | null>
  draft: string
  streaming: boolean
  /** See `ChatComposerProps.composerMode`. */
  composerMode?: ComposerMode | null
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
    if (showLanding || props.loadingConversation || props.voiceComposer || props.worktreeRemoved || props.questionDocked) Keyboard.dismiss()
  }, [showLanding, props.loadingConversation, !!props.voiceComposer, props.worktreeRemoved, props.questionDocked])
  const coveringRestore = props.loadingConversation || hold || (coverUntilReady && !rendererReady)
  const hideRenderer = coveringRestore || showLanding || !rendererReady
  // Captured on first mount: changing `injectedJavaScriptBeforeContentLoaded`
  // remounts WKWebView and would flash the white default we are covering.
  const prePaint = useRef(chatViewPrePaintScript(tokens.colors.background, tokens.scheme)).current
  const [channel] = useState(() => createChatWebViewChannel((message) => injectHostMessage(props.webRef, message)))
  const schedule = props.scheduledSend
  useEffect(() => {
    if (!rendererReady) return
    injectHostMessage(props.webRef, { type: 'setScheduledSend', state: {
      scheduled: props.loadingConversation || showLanding || props.voiceComposer ? null : schedule?.scheduled ?? null,
      available: schedule?.available ?? false, busy: schedule?.busy ?? false, error: schedule?.error ?? '',
    } })
  }, [rendererReady, props.loadingConversation, showLanding, !!props.voiceComposer, schedule?.scheduled, schedule?.available, schedule?.busy, schedule?.error, props.webRef])
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
        showsVerticalScrollIndicator={false}
        injectedJavaScriptBeforeContentLoaded={prePaint}
        style={[styles.flex, { backgroundColor: tokens.colors.background }]}
        containerStyle={{ backgroundColor: tokens.colors.background }}
        onLoadStart={channel.reset}
        onMessage={(event) => {
          const raw = channel.receive(event.nativeEvent.data)
          if (raw === null) return
          if (handleScheduledSendAction(raw, props.scheduledSend)) return
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
      {!props.loadingConversation && !props.worktreeRemoved ? props.collapsedPrompts?.map((prompt) => (
        <PendingPromptBar key={prompt.request.requestId} prompt={prompt} onExpand={(id) => props.onExpandPrompt?.(id)} />
      )) : null}
      {/* Hidden, never unmounted: the native editor clears a sent draft asynchronously, and
          unmounting it mid-send would restore the draft on the way back. */}
      <View testID="chat-composer-stack" style={props.composerHidden ? { display: 'none' } : undefined}>
        {props.worktreeRemoved ? <WorktreeRemovedBanner /> : <>
          {!props.loadingConversation && !props.voiceComposer ? <TodoPanel todos={props.todos} onAllTodosCompleted={props.onAllTodosCompleted} /> : null}
          {props.questionDocked ? null : props.inputComposer ?? props.voiceComposer}
        </>}
        <View testID="chat-text-composer" style={props.worktreeRemoved || props.inputComposer || props.voiceComposer || props.questionDocked ? { display: 'none' } : undefined}><ChatComposer {...props} /></View>
      </View>
    </View>
  )
}
