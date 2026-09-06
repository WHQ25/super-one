import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, BackHandler, findNodeHandle, Keyboard, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Text } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronRight } from 'lucide-react-native'
import { useMobileTheme } from '../theme/context'
import { popoverLayout, type AnchorRect } from './popover-layout'
import { useMenuHost } from './menu-host'

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
  return { ref, anchor, open, close }
}

type AnchoredMenuProps = {
  anchor: AnchorRect | null; title: string; onDismiss: () => void; children: ReactNode; width?: number
  /** Controls that belong on the title row, e.g. refresh and search. */
  titleAccessory?: ReactNode
}

export function AnchoredMenu(props: AnchoredMenuProps) {
  const host = useMenuHost()
  const id = useId()
  useEffect(() => {
    if (props.anchor) host.show(id, <MenuSurface {...props} />)
    else host.hide(id)
  }, [host, id, props.anchor, props.title, props.onDismiss, props.children, props.width, props.titleAccessory])
  useEffect(() => () => host.hide(id), [host, id])
  return null
}

function MenuSurface({ anchor, title, onDismiss, children, width = 300, titleAccessory }: AnchoredMenuProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
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
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null))
    return () => { show.remove(); hide.remove() }
  }, [])
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
  return <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onDismiss}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
      <View style={{ position: 'absolute', ...layout, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius.lg, backgroundColor: colors.surface, shadowColor: colors.foreground,
        shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
        <ScrollView keyboardShouldPersistTaps="always" bounces={false}
          onContentSizeChange={(_, height) => setContentHeight(height + 2)} contentContainerStyle={{ padding: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: titleAccessory ? 0 : 8 }}>
            <Text ref={titleRef} accessible accessibilityRole="header" style={{ paddingVertical: 8, fontSize: 12, color: colors.mutedForeground }}>{title}</Text>
            {titleAccessory}
          </View>
          {children}
        </ScrollView>
      </View>
    </View>
}

export function MenuRow({ label, labelNode, description, leading, selected, disabled, destructive, onPress }: {
  label: string; description?: string; leading?: ReactNode; selected?: boolean; disabled?: boolean
  /** Replaces the text label — e.g. a provider brand lockup. `label` stays the a11y name. */
  labelNode?: ReactNode
  destructive?: boolean; onPress: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const color = destructive ? colors.destructive : colors.foreground
  return <Pressable accessibilityRole={selected === undefined ? 'button' : 'radio'} accessibilityLabel={label}
    accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.sm, opacity: disabled ? 0.45 : 1,
      backgroundColor: pressed || selected ? colors.muted : 'transparent' })}>
    {leading}
    <View style={{ flex: 1, gap: 3 }}>
      {labelNode ?? <Text style={{ color, fontSize: 13, fontWeight: '500' }}>{label}</Text>}
      {description ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{description}</Text> : null}
    </View>
    {selected ? <Check size={15} color={colors.primary} /> : null}
  </Pressable>
}

/** A row that opens a deeper level of the same menu instead of committing a choice. */
export function MenuDisclosureRow({ label, description, disabled, onPress }: {
  label: string; description?: string; disabled?: boolean; onPress: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, expanded: false }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.sm, opacity: disabled ? 0.45 : 1,
      backgroundColor: pressed ? colors.muted : 'transparent' })}>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>{label}</Text>
      {description ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{description}</Text> : null}
    </View>
    <ChevronRight size={15} color={colors.mutedForeground} />
  </Pressable>
}

export function MenuSeparator() {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
}
