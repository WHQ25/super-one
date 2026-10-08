import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { BackHandler, Keyboard, Platform, Pressable, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, Save, UnfoldVertical, X } from 'lucide-react-native'
import { PASTE_TEXT_DIALOG as dialog, PASTE_TEXT_EDITOR as editor } from '@superone/ui/lib/paste-chip-presentation'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { monospace } from '../prompts/styles'
import { useMenuHost } from './menu-host'
import { IconButton } from './icon-button'
import { Text } from './text'

function PasteAction(props: ComponentProps<typeof IconButton>) {
  return <IconButton {...props} iconSize={dialog.actionIconSize} strokeWidth={2} hitSlop={10}
    style={{ width: dialog.actionSize, height: dialog.actionSize, borderRadius: dialog.actionRadius }} />
}

/** The desktop text window, with native text input and acknowledged saves. */
export function PasteChipEditor({ text, onApply, onClose, editorHeight = 320 }: {
  text: string; onApply(text: string, expand: boolean): Promise<boolean>; onClose(): void; editorHeight?: number
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState(text)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const dirty = draft !== text
  const count = draft.split('\n').length
  const title = t(count === 1 ? 'Pasted text · {{count}} line' : 'Pasted text · {{count}} lines').replace('{{count}}', String(count))
  const apply = async (expand: boolean) => {
    if (busy || (!expand && !dirty)) return
    setBusy(true); setError(null)
    try {
      if (await onApply(draft, expand)) onClose()
      else setError(t('Could not save pasted text. Please try again.'))
    } catch { setError(t('Could not save pasted text. Please try again.')) }
    finally { setBusy(false) }
  }
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(draft)
      setCopied(true); setError(null)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch { setError(t('Could not copy pasted text. Please try again.')) }
  }
  return <View testID="paste-text-window" style={{ backgroundColor: colors.background, borderWidth: 1,
    borderColor: colors.border, borderRadius: dialog.radius, overflow: 'hidden' }}>
    <View testID="paste-text-header" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: 1, borderBottomColor: colors.border,
      paddingHorizontal: dialog.headerPaddingHorizontal, paddingVertical: dialog.headerPaddingVertical }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: colors.foreground,
        fontSize: dialog.titleFontSize, lineHeight: dialog.titleLineHeight, fontWeight: '500' }}>
        {title}{dirty ? <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '400' }}>{`  ${t('(unsaved)')}`}</Text> : null}
      </Text>
      <View style={{ flexDirection: 'row', gap: dialog.actionGap }}>
        <PasteAction icon={UnfoldVertical} label="Expand to plain text" disabled={busy} onPress={() => void apply(true)} />
        <PasteAction icon={Save} label="Save" disabled={busy || !dirty} onPress={() => void apply(false)} />
        <PasteAction icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} disabled={busy} onPress={() => void copy()} />
        <PasteAction icon={X} label="Close" onPress={onClose} />
      </View>
    </View>
    <TextInput accessibilityLabel={t('Pasted text')} value={draft}
      onChangeText={(next) => { setDraft(next); setCopied(false) }} editable={!busy} multiline scrollEnabled
      autoCorrect={false} spellCheck={false}
      style={{ ...editor, fontFamily: monospace, color: colors.foreground, height: editorHeight,
        backgroundColor: 'transparent', borderWidth: 0, textAlignVertical: 'top' }} />
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12, paddingHorizontal: editor.padding, paddingBottom: editor.padding }}>{error}</Text> : null}
  </View>
}

function PasteDialogSurface({ chip, onApply, onDismiss }: PasteDialogProps & { chip: NonNullable<PasteDialogProps['chip']> }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { t } = useMobileLocale()
  const [keyboardTop, setKeyboardTop] = useState<number | null>(Keyboard.metrics()?.screenY ?? null)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event =>
      setKeyboardTop(event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null))
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onDismiss(); return true })
    return () => { show.remove(); hide.remove(); back.remove() }
  }, [onDismiss])
  const bottom = Math.min(height - insets.bottom, keyboardTop ?? height)
  const available = Math.max(0, bottom - insets.top - dialog.viewportMargin * 2)
  const headerHeight = dialog.actionSize + dialog.headerPaddingVertical * 2 + 2
  const editorHeight = Math.max(0, Math.min(height * dialog.editorHeightRatio, available * dialog.maxHeightRatio - headerHeight - editor.padding * 2))
  return <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
    accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Close pasted text')} onPress={onDismiss}
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#00000080' }} />
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + dialog.viewportMargin, height: available,
      left: dialog.viewportMargin, right: dialog.viewportMargin, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: Math.min(width - dialog.viewportMargin * 2, dialog.maxWidth) }}>
        <PasteChipEditor key={chip.offset} text={chip.value} editorHeight={editorHeight} onApply={onApply} onClose={onDismiss} />
      </View>
    </View>
  </View>
}

type PasteDialogProps = { chip: { value: string; offset: number } | null
  onApply(text: string, expand: boolean): Promise<boolean>; onDismiss(): void }

/** Same-window portal: a native Modal would steal the composer's IME. */
export function PasteChipEditorDialog(props: PasteDialogProps) {
  const host = useMenuHost()
  const id = useId()
  useEffect(() => {
    if (props.chip) host.show(id, <PasteDialogSurface {...props} chip={props.chip} />)
    else host.hide(id)
  }, [host, id, props.chip, props.onApply, props.onDismiss])
  useEffect(() => () => host.hide(id), [host, id])
  return null
}
