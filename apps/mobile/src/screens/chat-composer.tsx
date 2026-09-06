import { NativeComposerInput, type NativeComposerBinding } from '../ui/native-composer-input'
import { nativeMentionEditorAvailable } from '../ui/native-mention-editor'
import type { ComposerCursor } from '../composer-cursor'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import type { ReactNode } from 'react'
import { AttachmentStrip } from '../ui/attachment-strip'
import { SlashSuggestions, MentionSuggestions } from '../ui/composer-suggestions'
import { ModelPicker } from '../ui/model-picker'
import { ArrowUp, Paperclip, Square } from 'lucide-react-native'
import { ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { Text } from '../ui/text'
import type {
  HarnessId, ModelOption, ImageAttachment, RemoteActiveProvider, RemoteAgentOption,
  RemoteEffortOption, RemoteModeOption, RemoteProviderOption, SandboxInfo, SandboxMode,
} from '@superone/shared/agent-types'
import type { SelectorCatalogParam } from '../model-picker-state'
import type { filterSlashCommands } from '../slash'
import type { MentionItem } from '../mentions'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ContextRing, IconButton, PermissionModeSelector, SandboxSelector } from '../ui'

export type ComposerSelection = {
  model: string; models: ModelOption[]; effort: string; efforts: RemoteEffortOption[]
  providerName?: string; activeProvider?: RemoteActiveProvider | null; acpAgentId?: string | null
  onRefresh?: () => Promise<void>
  onModel: (model: string) => void; onEffort: (effort: string) => void
  /** Harness-native catalogs the desktop selector also shows. */
  agents?: RemoteAgentOption[]; agent?: string | null; onAgent?: (agent: string) => void
  modes?: RemoteModeOption[]; mode?: string | null; modeLabel?: string; modesLocked?: boolean
  onMode?: (mode: string) => void
  optionParams?: SelectorCatalogParam[]; onOptionParam?: (id: string, value: string) => void
  providers?: RemoteProviderOption[]; providerId?: string | null; onProvider?: (id: string | null) => void
}

export type ChatComposerProps = {
  nativeDraft?: NativeComposerBinding
  provider: HarnessId
  draft: string; streaming: boolean; attachments: ImageAttachment[]
  starting?: boolean
  permissionModes: string[]; permissionMode: string; additionalDirectories: string[]
  /** Runtime fact from the host; `null` until it has reported one. */
  sandboxInfo: SandboxInfo | null
  contextTokens: number; contextWindow: number | null; totalCostUsd: number
  slashHits: ReturnType<typeof filterSlashCommands>; mentionHits: MentionItem[]
  onDraft: (value: string) => void; onSend: () => void; onStop: () => void
  onSubmitFromKeyboard: () => void; onAttachmentMenu: () => void
  onRemoveAttachment: (attachment: ImageAttachment) => void
  onPermissionMode: (mode: string) => void; onSandboxMode: (mode: SandboxMode) => void
  onSlash: (command: string) => void
  onMention: (item: MentionItem) => void; selection?: ComposerSelection
  onCursorChange?: (selection: ComposerCursor) => void
  requestedCursor?: ComposerCursor
  mentionSearch?: MentionSearchState
  onMentionRetry?: () => void
  placeholder?: string; above?: ReactNode
}

export function ChatComposer(props: ChatComposerProps) {
  const styles = useMobileStyles()
  const { tokens: { colors, radius } } = useMobileTheme()
  const tablet = useWindowDimensions().width >= 768
  // `flexGrow` + `justifyContent` centre the chips while they fit and go inert once
  // they overflow, so a long model name still scrolls from the left edge.
  const controls = <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
    style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
    {props.selection ? <>
      <ModelPicker {...props.selection} harness={props.provider} compact disabled={props.starting} />
    </> : null}
    <PermissionModeSelector harness={props.provider} disabled={props.starting} modes={props.permissionModes} value={props.permissionMode} onChange={props.onPermissionMode} />
    <ContextRing tokens={props.contextTokens} contextWindow={props.contextWindow} costUsd={props.totalCostUsd} />
    {props.additionalDirectories.length ? <Text style={styles.directoryHint}>+{props.additionalDirectories.length} directories</Text> : null}
    <SandboxSelector harness={props.provider} disabled={props.starting} sandboxInfo={props.sandboxInfo}
      permissionMode={props.permissionMode} onChange={props.onSandboxMode} />
  </ScrollView>
  const attach = <IconButton icon={Paperclip} label="Add attachment" disabled={props.starting} onPress={props.onAttachmentMenu} />
  const send = <IconButton icon={props.streaming ? Square : ArrowUp} label={props.streaming ? 'Stop' : 'Send'}
    tone={props.streaming ? 'danger' : tablet ? 'muted' : 'primary'} chrome={tablet ? 'circle' : 'plain'}
    iconSize={tablet ? 13 : props.streaming ? 22 : 20}
    disabled={props.starting || (!props.streaming && !props.draft.trim() && !props.attachments.length)}
    onPress={props.streaming ? props.onStop : props.onSend} />
  return <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, gap: 6, backgroundColor: colors.background }}>
    {props.above}
    {!tablet ? <View testID="phone-composer-status" style={{ flexDirection: 'row', minHeight: 44 }}>{controls}</View> : null}
    <SlashSuggestions matches={props.slashHits} onSelect={props.onSlash} />
    <MentionSuggestions items={props.mentionHits} onSelect={props.onMention} search={props.mentionSearch} onRetry={props.onMentionRetry} />
    <View testID={tablet ? 'tablet-composer' : 'phone-composer'} style={tablet
      ? { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 6 }
      : { flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      {!tablet ? attach : null}
      <View style={tablet ? undefined : { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, overflow: 'hidden' }}>
        {props.attachments.length ? <View style={{ padding: 6 }}><AttachmentStrip attachments={props.attachments} onRemove={props.onRemoveAttachment} /></View> : null}
        {props.nativeDraft && nativeMentionEditorAvailable ? <NativeComposerInput binding={props.nativeDraft} tablet={tablet}
          editable={!props.starting} placeholder={props.placeholder ?? 'Ask anything…'} onSubmit={props.onSubmitFromKeyboard} /> : <TextInput
          accessibilityLabel="Message"
          editable={!props.starting}
          style={{ color: colors.foreground, fontSize: 15, lineHeight: 22, minHeight: tablet ? 64 : 42, maxHeight: 144, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' }}
          placeholder={props.placeholder ?? 'Ask anything…'} placeholderTextColor={colors.mutedForeground}
          value={props.draft} onChangeText={props.onDraft} multiline submitBehavior={tablet ? 'submit' : 'newline'}
          selection={props.requestedCursor}
          onSelectionChange={(event) => props.onCursorChange?.(event.nativeEvent.selection)}
          onSubmitEditing={props.onSubmitFromKeyboard} autoCorrect
        />}
      </View>
      {tablet ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{attach}{controls}{send}</View> : send}
    </View>
  </View>
}
