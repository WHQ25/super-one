import type { NativeComposerBinding } from '../ui/native-composer-input'
import type { ComposerCursor } from '../composer-cursor'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { LoadingOverlay } from '../ui/loading-overlay'
import { useState, type RefObject } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
} from 'lucide-react-native'
import { Pressable, ActivityIndicator, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import type { ChatMessage, HarnessId, ImageAttachment, TodoItem } from '@superone/shared/agent-types'
import type { filterSlashCommands } from '../slash'
import type { MentionItem } from '../mentions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ChatComposer, type ComposerSelection } from './chat-composer'
import { NewSessionLanding, type NewSessionLandingProps } from './new-session-landing'

const CHAT_SOURCE = { html: CHAT_VIEW_HTML }

export function ChatScreen(props: {
  nativeDraft?: NativeComposerBinding
  provider: HarnessId
  landing?: NewSessionLandingProps
  starting?: boolean
  selection?: ComposerSelection
  webRef: RefObject<WebView | null>
  permissionModes: string[]
  permissionMode: string
  slashHits: ReturnType<typeof filterSlashCommands>
  mentionHits: MentionItem[]
  attachments: ImageAttachment[]
  additionalDirectories: string[]
  queuedMessages: ChatMessage[]
  todos: Record<string, TodoItem>
  onCursorChange?: (selection: ComposerCursor) => void
  requestedCursor?: ComposerCursor
  mentionSearch?: MentionSearchState
  onMentionRetry?: () => void
  draft: string
  streaming: boolean
  onWebMessage: (raw: string) => void
  onWebProcessError: (message: string) => void
  onPermissionMode: (mode: string) => void
  onSlash: (command: string) => void
  onMention: (item: MentionItem) => void
  onRemoveAttachment: (attachment: ImageAttachment) => void
  onAttachmentMenu: () => void
  onDraft: (value: string) => void
  onSubmitFromKeyboard: () => void
  onSend: () => void
  onStop: () => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const [todosExpanded, setTodosExpanded] = useState(false)
  const todoItems = Object.values(props.todos)
  const completedTodos = todoItems.filter((todo) => todo.status === 'completed').length
  const activeTodo = todoItems.find((todo) => todo.status === 'in_progress')
    ?? todoItems.find((todo) => todo.status !== 'completed')
  return (
    <View style={styles.flex}>
      {props.starting ? <View style={styles.emptyState}><ActivityIndicator color={tokens.colors.mutedForeground} /><Text style={styles.emptyBody}>Starting session…</Text></View> : props.landing ? <NewSessionLanding {...props.landing} /> : <WebView
        ref={props.webRef}
        originWhitelist={['*']}
        source={CHAT_SOURCE}
        startInLoadingState
        renderLoading={() => <LoadingOverlay label="Loading conversation…" />}
        style={styles.flex}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
        onContentProcessDidTerminate={() => props.onWebProcessError('content process terminated')}
        onRenderProcessGone={() => props.onWebProcessError('render process terminated')}
      />}
      {todoItems.length ? (
        <View style={styles.todoPanel}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: todosExpanded }}
            onPress={() => setTodosExpanded((expanded) => !expanded)}
            style={styles.todoHeader}
          >
            {todosExpanded
              ? <ChevronDown color={tokens.colors.mutedForeground} size={16} />
              : <ChevronRight color={tokens.colors.mutedForeground} size={16} />}
            <View style={styles.flex}>
              <Text style={styles.rowMeta}>{completedTodos}/{todoItems.length} tasks</Text>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {activeTodo?.activeForm ?? activeTodo?.subject ?? 'Tasks complete'}
              </Text>
            </View>
          </Pressable>
          {todosExpanded ? (
            <View style={styles.todoList}>
              {todoItems.map((todo) => {
                const Icon = todo.status === 'completed'
                  ? CheckCircle2
                  : todo.status === 'in_progress'
                    ? LoaderCircle
                    : Circle
                const color = todo.status === 'completed'
                  ? tokens.colors.success
                  : todo.status === 'in_progress'
                    ? tokens.colors.primary
                    : tokens.colors.mutedForeground
                return (
                  <View key={todo.id} style={styles.todoRow}>
                    <Icon color={color} size={15} />
                    <Text numberOfLines={2} style={styles.rowMeta}>
                      {todo.status === 'in_progress' ? todo.activeForm || todo.subject : todo.subject}
                    </Text>
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {props.queuedMessages.length ? (
        <View style={styles.queuedRow}>
          <Text numberOfLines={1} style={styles.rowMeta}>{props.queuedMessages.length} queued · waiting for the current turn</Text>
        </View>
      ) : null}
      <ChatComposer {...props} />
    </View>
  )
}
