import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { ChevronRight, NotebookPen, Pin } from 'lucide-react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { useIconMotion } from './use-icon-motion'
import { DRAFT_GROUP_EASING, DRAFT_GROUP_MS } from '../navigation/draft-motion'

const SECTION_ICON = { pinned: Pin, drafts: NotebookPen } as const

/**
 * Heading for the cross-project Pinned and Drafts groups.
 * The desktop glyph stays in the slot (Pin, NotebookPen). A chevron at the
 * end points down while the group is open. The count badge shows only while
 * the group is folded, as on the desktop.
 */
export function WorkspaceSectionHeading({
  section,
  title,
  count,
  collapsed,
  onToggle,
}: {
  section: keyof typeof SECTION_ICON
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const Icon = SECTION_ICON[section]
  const label = collapsed && count > 0 ? `${title}, ${count}` : title
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={label}
      testID={`workspace-section-${section}`}
      onPress={onToggle}
      style={({ pressed }) => ({
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View testID={`workspace-section-icon-${section}`} accessible={false} style={{ width: 14, height: 14 }}>
        <Icon size={14} color={colors.mutedForeground} />
      </View>
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.mutedForeground, fontSize: 12, fontWeight: '500' }}>{title}</Text>
      {collapsed && count > 0 ? (
        <View
          testID={`workspace-section-count-${section}`}
          style={{
            marginLeft: 'auto',
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.muted,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '500', color: colors.mutedForeground, fontVariant: ['tabular-nums'] }}>{count}</Text>
        </View>
      ) : <View style={{ flex: 1 }} />}
      <SectionChevron collapsed={collapsed} color={colors.mutedForeground} />
    </Pressable>
  )
}

function SectionChevron({ collapsed, color }: { collapsed: boolean; color: string }) {
  const motion = useIconMotion()
  const rotation = useSharedValue(collapsed ? 0 : 90)
  const previous = useRef(collapsed)
  useEffect(() => {
    if (previous.current === collapsed) return
    previous.current = collapsed
    const to = collapsed ? 0 : 90
    rotation.value = motion
      ? withTiming(to, { duration: DRAFT_GROUP_MS, easing: Easing.bezier(...DRAFT_GROUP_EASING) })
      : to
  }, [collapsed, motion, rotation])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))
  return (
    <Animated.View accessible={false} style={style}>
      <ChevronRight size={14} color={color} />
    </Animated.View>
  )
}

/**
 * Clip a group open and shut. Rows stay mounted so a fold does not throw away
 * the list. The content is measured outside the clip: once its height is
 * known it is taken out of flow, and the clip eases between that height and
 * zero. The first measurement snaps, so opening the sidebar does not play
 * the fold.
 */
export function CollapsiblePanel({ open, testID, children }: { open: boolean; testID?: string; children: ReactNode }) {
  const motion = useIconMotion()
  const [measured, setMeasured] = useState<number | null>(null)
  const height = useSharedValue(0)
  const applied = useRef<number | null>(null)
  const target = measured == null ? null : (open ? measured : 0)
  useEffect(() => {
    if (target == null || applied.current === target) return
    const first = applied.current == null
    applied.current = target
    height.value = first || !motion
      ? target
      : withTiming(target, { duration: open ? 200 : DRAFT_GROUP_MS, easing: Easing.bezier(...DRAFT_GROUP_EASING) })
  }, [target, open, motion, height])
  const animated = useAnimatedStyle(() => ({ height: height.value }))
  return (
    <Animated.View
      testID={testID}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      style={measured == null
        ? { overflow: 'hidden', height: open ? undefined : 0 }
        : [{ overflow: 'hidden' }, animated]}
    >
      <View
        collapsable={false}
        style={measured == null ? { flexShrink: 0 } : { position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height)
          if (next <= 0) return
          // Prime the clip before the measured render, or the first locked
          // frame paints the shared value's initial zero.
          if (applied.current == null) {
            const to = open ? next : 0
            applied.current = to
            height.value = to
          }
          setMeasured((current) => (current === next ? current : next))
        }}
      >
        {children}
      </View>
    </Animated.View>
  )
}
