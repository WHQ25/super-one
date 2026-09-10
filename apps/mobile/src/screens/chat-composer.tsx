import { NativeComposerInput, composerInputMinHeight, COMPOSER_INPUT_MAX_HEIGHT, type NativeComposerBinding } from '../ui/native-composer-input'
import { nativeMentionEditorAvailable } from '../ui/native-mention-editor'
import type { ComposerCursor } from '../composer-cursor'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import type { ReactNode } from 'react'
import { AttachmentStrip } from '../ui/attachment-strip'
import { SlashSuggestions, MentionSuggestions, PromptSuggestions } from '../ui/composer-suggestions'
import { ModelPicker } from '../ui/model-picker'
import { ArrowUp, Paperclip, Square } from 'lucide-react-native'
import { ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { shouldUseTabletComposer } from '../layout-state'
import { useKeyboardVisible } from '../ui/use-keyboard-visible'
import type {
  HarnessId, ModelOption, ImageAttachment, RemoteActiveProvider, RemoteAgentOption,
  RemoteEffortOption, RemoteModeOption, RemoteProviderOption, SandboxInfo, SandboxMode,
  SandboxSupportLevel,
} from '@superone/shared/agent-types'
import type { SelectorCatalogParam } from '../model-picker-state'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import type { MentionItem } from '../mentions'
import { mentionBreadcrumbs } from '../mention-browse-state'
import { isSessionMentionQuery } from '../session-mention'
import type { MentionRow } from '../mention-rows'
import { useMobileTheme } from '../theme/context'
import { AdditionalDirsChip, ContextRing, IconButton, PermissionModeSelector, SandboxSelector } from '../ui'
import { CHIP_HEIGHT } from '../ui/chip-metrics'

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
  /**
   * Session restore is in flight. The chips above the input belong to the
   * session being left, so they stay off until the new facts arrive.
   */
  loadingConversation?: boolean
  permissionModes: string[]; permissionMode: string
  /**
   * The folders the agent sees beyond the project root, by scope — a launch-time
   * readout, so the caller empties them once the session is running rather than
   * this row deciding for itself.
   */
  projectDirs: string[]
  sessionDirs: string[]
  /** Opens the page that lists and edits them — the same one `/add-dir` opens. */
  onManageDirectories: () => void
  /** Runtime fact from the host; `null` until it has reported one. */
  sandboxInfo: SandboxInfo | null
  /** Host platform sandbox capability, reported by the harness catalog. */
  sandboxSupport?: SandboxSupportLevel
  contextTokens: number; contextWindow: number | null; totalCostUsd: number
  slashHits: MatchedSlashCommand[]; slashCatalogStatus: SlashCatalogStatus; mentionRows: MentionRow[]
  /**
   * End-of-turn follow-ups from the harness. Unlike desktop none of them go into
   * the input as ghost text — there is no Tab key to accept one — so the whole
   * list is tappable chips.
   */
  promptSuggestions?: string[]
  onPromptSuggestion?: (suggestion: string) => void
  onDraft: (value: string) => void; onSend: () => void; onStop: () => void
  onSubmitFromKeyboard: () => void; onAttachmentMenu: () => void
  onRemoveAttachment: (attachment: ImageAttachment) => void
  onPermissionMode: (mode: string) => void; onSandboxMode: (mode: SandboxMode) => void
  onSlash: (command: string) => void
  onSlashDismiss: () => void
  onMention: (item: MentionItem) => void; selection?: ComposerSelection
  onCursorChange?: (selection: ComposerCursor) => void
  requestedCursor?: ComposerCursor
  mentionSearch?: MentionSearchState
  onMentionRetry?: () => void
  onMentionLoadMore?: () => void
  /** The raw `@` query, so the overlay can show where in the tree it points. */
  mentionQuery?: string | null
  mentionGroupLabels?: Partial<Record<string, string>>
  placeholder?: string
  /**
   * Pin the chrome for stories. Unset in production — width and height decide
   * (`shouldUseTabletComposer`). A landscape phone is wide enough for the
   * sidebar but too short for the boxed card.
   */
  tablet?: boolean
  /**
   * The one overlay above the input, when a command owns it.
   *
   * Composer surfaces are mutually exclusive, not stacked: a command that opens
   * a panel is answering the same keystrokes the suggestion lists are, and
   * showing both is how `/add-dir` ended up drawn on top of a command list
   * still offering `/add-dir`. Desktop and Flutter both pick exactly one.
   */
  overlay?: ReactNode
}

export function ChatComposer(props: ChatComposerProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { width, height } = useWindowDimensions()
  const tablet = props.tablet ?? shouldUseTabletComposer(width, height)
  // The app's root SafeAreaView already clears the home indicator, so a gap of
  // our own on top of it left the composer a full input-height off the bottom.
  // Raising the keyboard hides that inset behind it without shrinking it, and
  // there the gap is ours to give.
  const insets = useSafeAreaInsets()
  const bottomGap = useKeyboardVisible() || !insets.bottom ? 8 : 0
  // Two anchored groups, not one centred line. The left group is what the next
  // turn will *do* — model, effort, permission mode — and reads from the same
  // edge as the message above it; the right group is what the session currently
  // *is*, three readouts that belong against the send side. Only the left
  // scrolls: a long model name has to stay reachable, while the readouts are
  // fixed-width glyphs that must not drift off the edge they are anchored to.
  // `flex: 1` on the scroller is what pins the right group, so it holds whether
  // the left group is one chip or three.
  const controls = <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
      {props.selection ? <ModelPicker {...props.selection} harness={props.provider} compact /> : null}
      <PermissionModeSelector harness={props.provider} modes={props.permissionModes} value={props.permissionMode} onChange={props.onPermissionMode} />
    </ScrollView>
    <View testID="composer-status-readouts" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ContextRing tokens={props.contextTokens} contextWindow={props.contextWindow} costUsd={props.totalCostUsd} />
      <SandboxSelector harness={props.provider} sandboxInfo={props.sandboxInfo}
        sandboxSupport={props.sandboxSupport} permissionMode={props.permissionMode} onChange={props.onSandboxMode} />
      {/* Last, on the outer edge: the only one of the three that comes and goes
          (it hides at zero), so anywhere else its arrival shifts the others. */}
      <AdditionalDirsChip projectDirs={props.projectDirs} sessionDirs={props.sessionDirs}
        onManage={props.onManageDirectories} />
    </View>
  </View>
  const attach = <IconButton icon={Paperclip} label="Add attachment" onPress={props.onAttachmentMenu} />
  const send = <IconButton icon={props.streaming ? Square : ArrowUp} label={props.streaming ? 'Stop' : 'Send'}
    tone={props.streaming ? 'danger' : tablet ? 'muted' : 'primary'} chrome={tablet ? 'circle' : 'plain'}
    iconSize={tablet ? 13 : props.streaming ? 22 : 20}
    disabled={props.loadingConversation || (!props.streaming && !props.draft.trim() && !props.attachments.length)}
    onPress={props.streaming ? props.onStop : props.onSend} />
  // Header, transcript, todo strip and input are **one background**; the input's
  // own edge is a border, not a fill. Desktop's `ChatInput` is `border
  // border-border` with no `bg-` class for the same reason — a filled input
  // turns the chat column into stacked planes instead of one sheet.
  return <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: bottomGap, gap: 4, backgroundColor: colors.background }}>
    {!tablet && !props.loadingConversation ? <View testID="phone-composer-status" style={{ flexDirection: 'row', minHeight: CHIP_HEIGHT }}>{controls}</View> : null}
    {props.overlay ?? <>
      {/* A typed `/` or `@` is an answer in progress; the turn's follow-ups are not
          competing for it, so they step aside rather than stacking above the list. */}
      {!props.slashHits.length && !props.mentionRows.length && !props.streaming && !props.loadingConversation
        ? <PromptSuggestions suggestions={props.promptSuggestions ?? []}
          onSelect={(suggestion) => props.onPromptSuggestion?.(suggestion)} />
        : null}
      <SlashSuggestions matches={props.slashHits} status={props.slashCatalogStatus} onSelect={props.onSlash} onDismiss={props.onSlashDismiss} />
      <MentionSuggestions rows={props.mentionRows} onSelect={props.onMention} search={props.mentionSearch}
        onRetry={props.onMentionRetry} onLoadMore={props.onMentionLoadMore} groupLabels={props.mentionGroupLabels}
        // A session title may contain a slash; only a path query has a trail.
        breadcrumbs={props.mentionQuery && !isSessionMentionQuery(props.mentionQuery)
          ? mentionBreadcrumbs(props.mentionQuery) : []} />
    </>}
    <View testID={tablet ? 'tablet-composer' : 'phone-composer'} style={tablet
      ? { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 6 }
      : { flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      {!tablet ? attach : null}
      <View style={tablet ? undefined : { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, overflow: 'hidden' }}>
        {props.attachments.length ? <View style={{ padding: 6 }}><AttachmentStrip attachments={props.attachments} onRemove={props.onRemoveAttachment} /></View> : null}
        {props.nativeDraft && nativeMentionEditorAvailable ? <NativeComposerInput key={props.nativeDraft.generation ?? 0} binding={props.nativeDraft} tablet={tablet}
          editable placeholder={props.placeholder ?? 'Ask anything…'} onSubmit={props.onSubmitFromKeyboard} /> : <TextInput
          accessibilityLabel="Message"
          style={{ color: colors.foreground, fontSize: 15, lineHeight: 22, minHeight: composerInputMinHeight(tablet), maxHeight: COMPOSER_INPUT_MAX_HEIGHT, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' }}
          placeholder={props.placeholder ?? 'Ask anything…'} placeholderTextColor={colors.mutedForeground}
          value={props.draft} onChangeText={props.onDraft} multiline submitBehavior={tablet ? 'submit' : 'newline'}
          selection={props.requestedCursor}
          onSelectionChange={(event) => props.onCursorChange?.(event.nativeEvent.selection)}
          onSubmitEditing={props.onSubmitFromKeyboard} autoCorrect
        />}
      </View>
      {tablet ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{attach}{props.loadingConversation ? null : controls}{send}</View> : send}
    </View>
  </View>
}
