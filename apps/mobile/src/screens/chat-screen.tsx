import type { RefObject } from 'react'
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
      {Object.keys(props.todos).length ? (
        <View style={styles.todoPanel}>
          <Text style={styles.rowMeta}>
            {Object.values(props.todos).filter((todo) => todo.status === 'completed').length}/{Object.keys(props.todos).length} tasks
          </Text>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {Object.values(props.todos).find((todo) => todo.status === 'in_progress')?.activeForm
              ?? Object.values(props.todos).find((todo) => todo.status !== 'completed')?.subject
              ?? 'Tasks complete'}
          </Text>
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
          {props.slashHits.slice(0, 8).map((hit) => (
            <Pressable key={hit.command.name} style={styles.row} onPress={() => props.onSlash(hit.command.name)}>
              <Text style={styles.rowTitle}>/{hit.command.name}</Text>
              <Text style={styles.rowMeta}>{hit.command.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {props.mentionHits.length ? (
        <ScrollView style={styles.overlay}>
          {props.mentionHits.slice(0, 8).map((item) => (
            <Pressable key={`${item.kind}:${item.path}`} style={styles.row} onPress={() => props.onMention(item)}>
              <Text style={styles.rowTitle}>{item.label ?? item.path}</Text>
              <Text style={styles.rowMeta}>{item.kind}</Text>
            </Pressable>
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
