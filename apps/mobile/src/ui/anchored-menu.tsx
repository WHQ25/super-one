import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { AccessibilityInfo, BackHandler, findNodeHandle, Keyboard, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { Text } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronRight } from 'lucide-react-native'
import { useMobileTheme } from '../theme/context'
import { popoverLayout, type AnchorRect } from './popover-layout'
import { useMenuHost } from './menu-host'
import { useMobileLocale } from '../i18n/context'

export function useMenuAnchor() {
  const ref = useRef<View>(null)
  const host = useMenuHost()
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const measurement = useRef(0)
  useEffect(() => () => { measurement.current++ }, [])
  const open = () => {
    const request = ++measurement.current
    host.measure(ref, (rect) => { if (request === measurement.current) setAnchor(rect) })
  }
  const close = () => {
    measurement.current++
    setAnchor(null)
    const handle = findNodeHandle(ref.current)
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
  }
  // Measuring again is the same request; the menu asks for it once its own
  // keyboard has moved the trigger.
  return { ref, anchor, open, remeasure: open, close }
}

type AnchoredMenuProps = {
  anchor: AnchorRect | null; title: string; onDismiss: () => void; children: ReactNode; width?: number
  /** Controls that belong on the title row, e.g. refresh and search. */
  titleAccessory?: ReactNode
  /** `useMenuAnchor().remeasure` — needed by menus that hold a `MenuTextInput`. */
  remeasure?: () => void
}

export function AnchoredMenu(props: AnchoredMenuProps) {
  const host = useMenuHost()
  const id = useId()
  useEffect(() => {
    if (props.anchor) host.show(id, <MenuSurface {...props} />)
    else host.hide(id)
  }, [host, id, props.anchor, props.title, props.onDismiss, props.children, props.width, props.titleAccessory, props.remeasure])
  useEffect(() => () => host.hide(id), [host, id])
  return null
}

function MenuSurface({ anchor, title, onDismiss, children, width = 300, titleAccessory, remeasure }: AnchoredMenuProps) {
  const { tokens: { colors, radius, shadows } } = useMobileTheme()
  const { t } = useMobileLocale()
  const translatedTitle = t(title)
  const viewport = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [keyboardTop, setKeyboardTop] = useState<number | null>(Keyboard.metrics()?.screenY ?? null)
  const [contentHeight, setContentHeight] = useState(320)
  const titleRef = useRef<Text>(null)
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onDismiss(); return true })
    return () => back.remove()
  }, [onDismiss])
  useEffect(() => {
    const handle = findNodeHandle(titleRef.current)
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
  }, [])
  // The trigger was measured against one keyboard state; the composer moves
  // with the keyboard, so either transition leaves the menu floating over a
  // spot its anchor has left. A foreign keyboard closes the menu as soon as it
  // starts moving. The menu's own keyboard — raised by a `MenuTextInput` — is
  // waited out instead, so the trigger can be measured again where it settled.
  // `keyboardDidShow` rather than `Will` so the field's `onFocus` has reached
  // JS before the show is judged.
  const ownsKeyboard = useRef(false)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      if (!ownsKeyboard.current) return onDismiss()
      setKeyboardTop(event.endCoordinates.screenY)
      remeasure?.()
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (!ownsKeyboard.current) return onDismiss()
      ownsKeyboard.current = false
      setKeyboardTop(null)
      remeasure?.()
    })
    const willHide = Platform.OS === 'ios'
      ? Keyboard.addListener('keyboardWillHide', () => { if (!ownsKeyboard.current) onDismiss() })
      : null
    return () => { show.remove(); hide.remove(); willHide?.remove() }
  }, [onDismiss, remeasure])
  // Rotation, split-view and Dynamic Type invalidate the measured trigger.
  const geometry = `${viewport.width}:${viewport.height}:${viewport.fontScale}:${insets.top}:${insets.bottom}`
  const lastSize = useRef(geometry)
  useEffect(() => {
    if (lastSize.current !== geometry && anchor) onDismiss()
    lastSize.current = geometry
  }, [geometry, anchor, onDismiss])
  const layout = popoverLayout(anchor ?? { x: 0, y: 0, width: 0, height: 0 }, {
    width: viewport.width, height: Math.min(viewport.height, keyboardTop ?? viewport.height),
    top: insets.top, bottom: keyboardTop == null ? insets.bottom : 0,
  }, width, contentHeight)
  return <MenuKeyboardContext.Provider value={ownsKeyboard}>
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('Close')} ${translatedTitle}`} onPress={onDismiss}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
      <View style={{ position: 'absolute', ...layout, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.popover }}>
        <ScrollView keyboardShouldPersistTaps="always" bounces={false}
          onContentSizeChange={(_, height) => setContentHeight(height + 2)} contentContainerStyle={{ padding: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: titleAccessory ? 0 : 8 }}>
            <Text ref={titleRef} accessible accessibilityRole="header" style={{ paddingVertical: 8, fontSize: 12, color: colors.mutedForeground }}>{translatedTitle}</Text>
            {titleAccessory}
          </View>
          {children}
        </ScrollView>
      </View>
    </View>
  </MenuKeyboardContext.Provider>
}

const MenuKeyboardContext = createContext<{ current: boolean } | null>(null)

/** A text field inside a menu: the keyboard it raises is the menu's own, so the
 * menu reflows around it instead of closing. */
export function MenuTextInput(props: ComponentProps<typeof TextInput>) {
  const ownsKeyboard = useContext(MenuKeyboardContext)
  return <TextInput {...props} onFocus={(event) => { if (ownsKeyboard) ownsKeyboard.current = true; props.onFocus?.(event) }} />
}

export function MenuRow({ label, labelNode, description, leading, accessory, selected, showCheck = true, disabled, destructive, onPress }: {
  label: string; description?: string; leading?: ReactNode; selected?: boolean; disabled?: boolean
  /** Replaces the text label — e.g. a provider brand lockup. `label` stays the a11y name. */
  labelNode?: ReactNode
  /** Trailing detail on the label's own line — e.g. which key a provider runs on. */
  accessory?: ReactNode
  /** Selected rows already tint the background; the check is optional. */
  showCheck?: boolean
  destructive?: boolean; onPress: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const translatedLabel = t(label)
  const translatedDescription = description ? t(description) : undefined
  const color = destructive ? colors.destructive : colors.foreground
  return <Pressable accessibilityRole={selected === undefined ? 'button' : 'radio'} accessibilityLabel={translatedLabel}
    accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.sm, opacity: disabled ? 0.45 : 1,
      backgroundColor: pressed || selected ? colors.muted : 'transparent' })}>
    {leading}
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      {labelNode ?? <Text style={{ color, fontSize: 13, fontWeight: '500' }}>{translatedLabel}</Text>}
      {translatedDescription ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{translatedDescription}</Text> : null}
    </View>
    {accessory}
    {selected && showCheck ? <Check size={15} color={colors.primary} /> : null}
  </Pressable>
}

/** A row that opens a deeper level of the same menu instead of committing a choice. */
export function MenuDisclosureRow({ label, labelNode, description, accessory, disabled, onPress }: {
  label: string; description?: string; disabled?: boolean; onPress: () => void
  /** Replaces the text label — e.g. a provider brand lockup. `label` stays the a11y name. */
  labelNode?: ReactNode
  /** Trailing detail on the label's own line — e.g. which key a provider runs on. */
  accessory?: ReactNode
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const translatedLabel = t(label)
  const translatedDescription = description ? t(description) : undefined
  // `labelNode` draws the label as artwork, so the name has to be spelled out
  // here — the composed one RN would derive from the children is gone with it.
  return <Pressable accessibilityRole="button" accessibilityLabel={[translatedLabel, translatedDescription].filter(Boolean).join(', ')}
    accessibilityState={{ disabled, expanded: false }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.sm, opacity: disabled ? 0.45 : 1,
      backgroundColor: pressed ? colors.muted : 'transparent' })}>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      {labelNode ?? <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>{translatedLabel}</Text>}
      {translatedDescription ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{translatedDescription}</Text> : null}
    </View>
    {accessory}
    <ChevronRight size={15} color={colors.mutedForeground} />
  </Pressable>
}

export function MenuSeparator() {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
}
