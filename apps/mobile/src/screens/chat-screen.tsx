import { useState, type RefObject } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Command,
  File,
  Folder,
  LoaderCircle,
  Sparkles,
  Wrench,
} from 'lucide-react-native'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import type { ChatMessage, ImageAttachment, TodoItem } from '@superone/shared/agent-types'
import type { filterSlashCommands } from '../slash'
import type { MentionItem } from '../mentions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { PermissionModeSelector } from '../ui'

export function ChatScreen(props: {
  webRef: RefObject<WebView | null>
  permissionModes: string[]
  permissionMode: string
  slashHits: ReturnType<typeof filterSlashCommands>
  mentionHits: MentionItem[]
  attachments: ImageAttachment[]
  additionalDirectories: string[]
  queuedMessages: ChatMessage[]
  todos: Record<string, TodoItem>
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
  const mentionSections = [
    { title: 'Agents', items: props.mentionHits.filter((item) => item.kind === 'agent') },
    { title: 'Built-ins', items: props.mentionHits.filter((item) => item.kind === 'builtin') },
    { title: 'Files & folders', items: props.mentionHits.filter((item) => item.kind !== 'agent' && item.kind !== 'builtin') },
  ].filter((section) => section.items.length > 0)
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WebView
        ref={props.webRef}
        originWhitelist={['*']}
        source={{ html: CHAT_VIEW_HTML }}
        style={styles.flex}
        onMessage={(event) => props.onWebMessage(event.nativeEvent.data)}
        onContentProcessDidTerminate={() => props.onWebProcessError('content process terminated')}
        onRenderProcessGone={() => props.onWebProcessError('render process terminated')}
      />
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
      <View style={styles.composerControls}>
        <PermissionModeSelector
          modes={props.permissionModes}
          value={props.permissionMode}
          onChange={props.onPermissionMode}
        />
        {props.additionalDirectories.length ? (
          <Text numberOfLines={1} style={styles.directoryHint}>+{props.additionalDirectories.length} directories</Text>
        ) : null}
      </View>
      {props.slashHits.length ? (
        <ScrollView style={styles.overlay}>
          <Text style={styles.overlayHeader}>Commands</Text>
          {props.slashHits.slice(0, 8).map((hit) => (
            <Pressable
              accessibilityRole="button"
              key={hit.command.name}
              style={styles.overlayRow}
              onPress={() => props.onSlash(hit.command.name)}
            >
              <View style={styles.overlayIcon}>
                {hit.command.isSkill
                  ? <Sparkles color={tokens.colors.primary} size={17} />
                  : <Command color={tokens.colors.mutedForeground} size={17} />}
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>/{hit.command.name}</Text>
                {hit.command.description || hit.command.argumentHint ? (
                  <Text numberOfLines={2} style={styles.rowMeta}>
                    {[hit.command.description, hit.command.argumentHint].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {props.mentionHits.length ? (
        <ScrollView style={styles.overlay}>
          {mentionSections.map((section) => (
            <View key={section.title}>
              <Text style={styles.overlayHeader}>{section.title}</Text>
              {section.items.slice(0, 8).map((item) => {
                const Icon = item.kind === 'agent'
                  ? Bot
                  : item.kind === 'builtin'
                    ? Wrench
                    : item.isDirectory
                      ? Folder
                      : File
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={`${item.kind}:${item.path}`}
                    style={styles.overlayRow}
                    onPress={() => props.onMention(item)}
                  >
                    <View style={styles.overlayIcon}>
                      <Icon color={item.kind === 'agent' ? tokens.colors.primary : tokens.colors.mutedForeground} size={17} />
                    </View>
                    <View style={styles.flex}>
                      <Text numberOfLines={1} style={styles.rowTitle}>{item.label ?? item.path}</Text>
                      <Text numberOfLines={1} style={styles.rowMeta}>{item.path}</Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          ))}
        </ScrollView>
      ) : null}
      {props.attachments.length ? (
        <ScrollView horizontal style={styles.attachmentStrip} contentContainerStyle={styles.attachmentStripContent}>
          {props.attachments.map((attachment) => (
            <Pressable
              key={attachment.id ?? attachment.name}
              style={styles.attachmentChip}
              onPress={() => props.onRemoveAttachment(attachment)}
            >
              <Text numberOfLines={1} style={styles.attachmentText}>{attachment.name} ×</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.composer}>
        <Pressable style={styles.attach} onPress={props.onAttachmentMenu}>
          <Text style={styles.btnText}>＋</Text>
        </Pressable>
        <TextInput
          style={styles.composerInput}
          placeholder={props.streaming ? 'Streaming…' : 'Message'}
          placeholderTextColor={tokens.colors.mutedForeground}
          value={props.draft}
          onChangeText={props.onDraft}
          multiline
          submitBehavior="submit"
          onSubmitEditing={props.onSubmitFromKeyboard}
          autoCorrect
        />
        <Pressable style={styles.send} onPress={props.streaming ? props.onStop : props.onSend}>
          <Text style={styles.btnText}>{props.streaming ? 'Stop' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
