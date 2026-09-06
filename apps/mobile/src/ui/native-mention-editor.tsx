import { useRef, useState, type ComponentType } from 'react'
import { useMentionArtwork, type MentionArtwork } from './mention-artwork'
import { Platform, type ViewProps } from 'react-native'
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { parseMentionEditorSnapshot, type MentionEditorCommand, type MentionEditorSnapshot } from '../mention-editor-state'
import { IME_SETTLE_MS } from '../composer-state'
import { useMobileTheme } from '../theme/context'
import { BUILTIN_CAPABILITIES, LEGACY_CAPABILITY_IDS } from '@superone/shared/capability-prompt-tags'

const blendedKinds = [...BUILTIN_CAPABILITIES.map((item) => item.id), ...LEGACY_CAPABILITY_IDS, 'agent-profile', 'desktop-app', 'session']

type NativeProps = ViewProps & {
  command: MentionEditorCommand; foreground: string; chipBackground: string
  submitOnReturn: boolean; onSubmit: (event: { nativeEvent: { eventCount: number } }) => void
  placeholder: string; editable: boolean; editorLabel: string
  artwork: MentionArtwork[]; mutedForeground: string; blendedKinds: string[]
  onContentHeightChange: (event: { nativeEvent: { height: number } }) => void
  onDocumentChange: (event: { nativeEvent: unknown }) => void
}
const NativeView: ComponentType<NativeProps> | null = (Platform.OS === 'ios' || Platform.OS === 'android')
  && requireOptionalNativeModule('SuperOneMentionEditor') ? requireNativeView<NativeProps>('SuperOneMentionEditor') : null
export const nativeMentionEditorAvailable = NativeView !== null

export function NativeMentionEditor({ command, onChange, onError, editable = true, placeholder = 'Ask anything…', autoSize, submitBehavior = 'newline', onSubmit, ...viewProps }: ViewProps & {
  editable?: boolean; placeholder?: string
  submitBehavior?: 'newline' | 'submit'; onSubmit?: (snapshot: MentionEditorSnapshot) => void
  autoSize?: { minHeight: number; maxHeight: number }
  command: MentionEditorCommand; onChange: (snapshot: MentionEditorSnapshot) => void; onError: (message: string) => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const latestEvent = useRef(-1)
  const lastTextChangeAt = useRef(0)
  const latestSnapshot = useRef<MentionEditorSnapshot | null>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [tokens, setTokens] = useState(command.tokens)
  const artwork = useMentionArtwork(tokens)
  if (!NativeView) return null
  return <NativeView {...viewProps} editable={editable} placeholder={placeholder} editorLabel={viewProps.accessibilityLabel ?? 'Message'} command={command} foreground={colors.foreground} chipBackground={colors.muted} artwork={artwork} mutedForeground={colors.mutedForeground} blendedKinds={blendedKinds}
    submitOnReturn={submitBehavior === 'submit'}
    onSubmit={({ nativeEvent }) => {
      const snapshot = latestSnapshot.current
      if (editable && Date.now() - lastTextChangeAt.current >= IME_SETTLE_MS && snapshot && !snapshot.composing && !snapshot.rejection && snapshot.eventCount === nativeEvent.eventCount) onSubmit?.(snapshot)
    }}
    style={[viewProps.style, autoSize ? { height: Math.max(autoSize.minHeight, Math.min(autoSize.maxHeight, contentHeight)) } : undefined]}
    onContentHeightChange={({ nativeEvent }) => {
      if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0) setContentHeight(Math.ceil(nativeEvent.height))
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
      onChange(snapshot)
    }} />
}
