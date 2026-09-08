import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useReportSwipeReveal } from './swipe-reveal-scope'
import type { LucideIcon } from 'lucide-react-native'
import { Alert, Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

/**
 * `block` fills the revealed area with labelled tiles — right for a short list of
 * chunky cards. `floating` drops the labels for round icon buttons sitting on the
 * list's own ground, which is what a dense single-line row can afford: three
 * labelled tiles would leave barely a third of the title readable.
 */
export type SwipeVariant = 'block' | 'floating'

const FLOATING_BUTTON = 34
const FLOATING_GAP = 8

export type SwipeAction = {
  /** Also the VoiceOver action name, so it must be stable and unique in the row. */
  key: string
  label: string
  icon: LucideIcon
  tone?: 'neutral' | 'destructive'
  /** Shown before the action runs. Destructive actions should always set this. */
  confirm?: { title: string; message: string; confirmLabel: string }
  onPress: () => void
}

/**
 * One row that hides actions behind a rightward swipe. The gesture, the reveal
 * animation and the VoiceOver equivalents live here so every list that needs
 * them — sessions, devices — behaves identically.
 *
 * `children` is a render prop because a revealed row has to square off the edge
 * that now abuts the action strip; a row that kept its corner radius there would
 * leave a rounded notch against the strip's straight edge.
 */
export function SwipeRow(props: {
  subject: string
  actions: SwipeAction[]
  variant?: SwipeVariant
  children: (state: { revealed: boolean }) => ReactNode
  onPress: () => void
}) {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const floating = props.variant === 'floating'
  const width = floating ? FLOATING_BUTTON : 76
  const actionsWidth = floating
    ? props.actions.length * (FLOATING_BUTTON + FLOATING_GAP) + FLOATING_GAP
    : width * props.actions.length
  const offset = useRef(new Animated.Value(0)).current
  const opened = useRef(false)
  const [revealed, setRevealed] = useState(false)
  const dragStart = useRef(0)
  const reportReveal = useReportSwipeReveal()

  const settle = (open: boolean) => {
    opened.current = open
    setRevealed(open)
    reportReveal(open)
    Animated.spring(offset, {
      toValue: open ? actionsWidth : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start()
  }

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (Math.abs(gesture.dx) <= 8 || Math.abs(gesture.dx) <= Math.abs(gesture.dy)) return false
      // Only the direction this row can actually travel. A closed row has
      // nothing to reveal leftward, and claiming that drag anyway would swallow
      // it before the panel behind the list — the drawer — could read it as a
      // swipe to close.
      return opened.current ? gesture.dx < 0 : gesture.dx > 0
    },
    onPanResponderGrant: () => {
      setRevealed(true)
      reportReveal(true)
      dragStart.current = opened.current ? actionsWidth : 0
    },
    onPanResponderMove: (_, gesture) => {
      offset.setValue(Math.min(actionsWidth, Math.max(0, dragStart.current + gesture.dx)))
    },
    onPanResponderRelease: (_, gesture) => {
      settle(dragStart.current + gesture.dx > actionsWidth / 2)
    },
    onPanResponderTerminate: () => settle(opened.current),
  }), [offset, actionsWidth, reportReveal])

  const run = (action: SwipeAction) => {
    settle(false)
    if (!action.confirm) {
      action.onPress()
      return
    }
    Alert.alert(t(action.confirm.title), action.confirm.message, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t(action.confirm.confirmLabel),
        style: action.tone === 'destructive' ? 'destructive' : 'default',
        onPress: action.onPress,
      },
    ])
  }

  // Rendered outward from the row: the first declared action ends up nearest the
  // content, so a destructive last action sits furthest from the resting edge.
  const strip = [...props.actions].reverse()

  return (
    <View style={[styles.container, floating && styles.floatingContainer]}>
      <View
        pointerEvents={revealed ? 'auto' : 'none'}
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
        style={[styles.actions, floating && styles.floatingActions, !revealed && { opacity: 0 }]}
      >
        {strip.map((action, index) => {
          const destructive = action.tone === 'destructive'
          const color = destructive ? tokens.colors.destructiveForeground : tokens.colors.foreground
          const Icon = action.icon
          // Same-tone neighbours would read as one block without a hairline.
          const previous = strip[index - 1]
          const divided = !floating && !!previous && (previous.tone ?? 'neutral') === (action.tone ?? 'neutral')
          return (
            <Pressable
              key={action.key}
              accessibilityLabel={`${t(action.label)} ${props.subject}`}
              accessibilityRole="button"
              onPress={() => run(action)}
              style={({ pressed }) => [
                floating ? styles.floatingAction : styles.action,
                { width },
                destructive ? styles.destructive : floating ? styles.floatingNeutral : styles.neutral,
                divided && styles.divided,
                pressed && styles.pressed,
              ]}
            >
              <Icon color={destructive ? tokens.colors.destructiveForeground : color} size={17} />
              {floating ? null : <Text style={[styles.actionLabel, { color }]}>{t(action.label)}</Text>}
            </Pressable>
          )
        })}
      </View>
      <Animated.View style={{ transform: [{ translateX: offset }] }} {...panResponder.panHandlers}>
        <Pressable
          accessibilityActions={[
            { name: 'activate' },
            ...props.actions.map((action) => ({ name: action.key, label: t(action.label) })),
          ]}
          accessibilityRole="button"
          onAccessibilityAction={(event) => {
            const action = props.actions.find((item) => item.key === event.nativeEvent.actionName)
            if (action) run(action)
            else props.onPress()
          }}
          onPress={() => opened.current ? settle(false) : props.onPress()}
        >
          {props.children({ revealed })}
        </Pressable>
      </Animated.View>
    </View>
  )
}

function useStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    container: {
      borderRadius: tokens.radius.lg,
      marginBottom: tokens.spacing.sm,
      overflow: 'hidden',
    },
    // A list of single-line rows reads as a list; the card gap would break it
    // into a stack of separate objects and cost a third of the visible rows.
    floatingContainer: { marginBottom: 2 },
    actions: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'stretch',
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    action: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.xs,
    },
    floatingActions: {
      alignItems: 'center',
      gap: FLOATING_GAP,
      paddingLeft: FLOATING_GAP,
    },
    floatingAction: {
      alignItems: 'center',
      borderRadius: FLOATING_BUTTON / 2,
      height: FLOATING_BUTTON,
      justifyContent: 'center',
    },
    floatingNeutral: { backgroundColor: tokens.colors.secondary },
    divided: { borderLeftColor: tokens.colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
    neutral: { backgroundColor: tokens.colors.secondary },
    destructive: { backgroundColor: tokens.colors.destructive },
    actionLabel: { fontSize: tokens.type.meta, fontWeight: '600' },
    pressed: { opacity: 0.75 },
  }), [tokens])
}
