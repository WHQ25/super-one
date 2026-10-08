import { useMemo, useRef, useState, type ComponentType } from 'react'
import { useMentionArtwork, type MentionArtwork } from './mention-artwork'
import { Platform, type ViewProps } from 'react-native'
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { parseMentionEditorSnapshot, type MentionEditorCommand, type MentionEditorSnapshot } from '../mention-editor-state'
import { IME_SETTLE_MS } from '../composer-state'
import { useMobileTheme } from '../theme/context'
import { BUILTIN_CAPABILITIES, LEGACY_CAPABILITY_IDS } from '@superone/shared/capability-prompt-tags'
import type { AnchorRect } from './popover-layout'
import type { PromptKeyword } from '@superone/shared/prompt-keywords'
import { keywordHighlight, type KeywordHighlight } from '../prompt-keyword-highlight'
import { useIconMotion } from './use-icon-motion'
import { pasteChrome } from './mention-artwork.generated.json'

const blendedKinds = [...BUILTIN_CAPABILITIES.map((item) => item.id), ...LEGACY_CAPABILITY_IDS, 'agent-profile', 'desktop-app', 'session', 'git', 'mcp-resource', ...(pasteChrome.blended ? ['paste'] : [])]
const { blended: _blended, ...pasteMetrics } = pasteChrome

type NativeProps = ViewProps & {
  command: MentionEditorCommand; foreground: string; chipBackground: string
  submitOnReturn: boolean; onSubmit: (event: { nativeEvent: { eventCount: number } }) => void
  placeholder: string; editable: boolean; editorLabel: string
  artwork: MentionArtwork[]; mutedForeground: string; blendedKinds: string[]
  pasteChrome: typeof pasteMetrics
  keywords: KeywordHighlight
  onContentHeightChange: (event: { nativeEvent: { height: number } }) => void
  onDocumentChange: (event: { nativeEvent: unknown }) => void
  onMentionPress: (event: { nativeEvent: Record<string, unknown> }) => void
}

/** A tapped chip and where it is drawn, in the editor's own points. */
export type MentionPress = { kind: string; value: string; offset: number; frame: AnchorRect }

function parseMentionPress(raw: Record<string, unknown>): MentionPress | null {
  const { kind, value, offset, x, y, width, height } = raw
  if (typeof kind !== 'string' || typeof value !== 'string') return null
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return null
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { kind, value, offset, frame: { x: x as number, y: y as number, width: width as number, height: height as number } }
}
const NativeView: ComponentType<NativeProps> | null = (Platform.OS === 'ios' || Platform.OS === 'android')
  && requireOptionalNativeModule('SuperOneMentionEditor') ? requireNativeView<NativeProps>('SuperOneMentionEditor') : null
export const nativeMentionEditorAvailable = NativeView !== null

const NO_KEYWORDS: readonly PromptKeyword[] = []

export function NativeMentionEditor({ command, onChange, onError, editable = true, placeholder = 'Ask anything…', autoSize, submitBehavior = 'newline', onSubmit, onMentionPress, promptKeywords = NO_KEYWORDS, ...viewProps }: ViewProps & {
  editable?: boolean; placeholder?: string
  /** The keywords the session's harness acts on, painted in the draft as on desktop. */
  promptKeywords?: readonly PromptKeyword[]
  /** A chip was tapped; the editor kept its caret and keyboard. Older dev clients never send it. */
  onMentionPress?: (press: MentionPress) => void
  submitBehavior?: 'newline' | 'submit'; onSubmit?: (snapshot: MentionEditorSnapshot) => void
  autoSize?: { minHeight: number; maxHeight: number }
  command: MentionEditorCommand; onChange: (snapshot: MentionEditorSnapshot) => void; onError: (message: string) => void
}) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const motion = useIconMotion()
  const [draft, setDraft] = useState({ text: command.text, eventCount: 0 })
  const keywords = useMemo(
    () => keywordHighlight(draft, promptKeywords, { dark: scheme === 'dark', animate: motion }),
    [draft, promptKeywords, scheme, motion],
  )
  const latestEvent = useRef(-1)
  const lastTextChangeAt = useRef(0)
  const latestSnapshot = useRef<MentionEditorSnapshot | null>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [tokens, setTokens] = useState(command.tokens)
  const artwork = useMentionArtwork(tokens)
  if (!NativeView) return null
  return <NativeView {...viewProps} editable={editable} placeholder={placeholder} editorLabel={viewProps.accessibilityLabel ?? 'Message'} command={command} foreground={colors.foreground} chipBackground={colors.muted} artwork={artwork} mutedForeground={colors.mutedForeground} blendedKinds={blendedKinds} pasteChrome={pasteMetrics} keywords={keywords}
    submitOnReturn={submitBehavior === 'submit'}
    onSubmit={({ nativeEvent }) => {
      const snapshot = latestSnapshot.current
      if (editable && Date.now() - lastTextChangeAt.current >= IME_SETTLE_MS && snapshot && !snapshot.composing && !snapshot.rejection && snapshot.eventCount === nativeEvent.eventCount) onSubmit?.(snapshot)
    }}
    style={[viewProps.style, autoSize ? { height: Math.max(autoSize.minHeight, Math.min(autoSize.maxHeight, contentHeight)) } : undefined]}
    onContentHeightChange={({ nativeEvent }) => {
      if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0) setContentHeight(Math.ceil(nativeEvent.height))
    }}
    onMentionPress={({ nativeEvent }) => {
      const press = parseMentionPress(nativeEvent)
      if (press) onMentionPress?.(press)
    }}
    onDocumentChange={(event) => {
      let snapshot: MentionEditorSnapshot
      try { snapshot = parseMentionEditorSnapshot(event.nativeEvent) }
      catch (error) { latestSnapshot.current = null; onError(error instanceof Error ? error.message : 'Could not read native draft'); return }
      if (snapshot.eventCount < latestEvent.current) return
      if (snapshot.eventCount > latestEvent.current) lastTextChangeAt.current = Date.now()
      latestEvent.current = snapshot.eventCount
      latestSnapshot.current = snapshot
      setTokens(snapshot.tokens)
      setDraft((current) => current.eventCount === snapshot.eventCount && current.text === snapshot.text
        ? current : { text: snapshot.text, eventCount: snapshot.eventCount })
      onChange(snapshot)
    }} />
}
