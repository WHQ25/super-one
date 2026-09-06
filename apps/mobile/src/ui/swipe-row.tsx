import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react-native'
import { Alert, Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'

const ACTION_WIDTH = 76

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
 * One row that hides actions behind a leftward swipe. The gesture, the reveal
 * animation and the VoiceOver equivalents live here so every list that needs
 * them — sessions, devices — behaves identically.
 */
export function SwipeRow(props: {
  subject: string
  actions: SwipeAction[]
  children: ReactNode
  onPress: () => void
}) {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  const actionsWidth = ACTION_WIDTH * props.actions.length
  const offset = useRef(new Animated.Value(0)).current
  const opened = useRef(false)
  const [revealed, setRevealed] = useState(false)
  const dragStart = useRef(0)

  const settle = (open: boolean) => {
    opened.current = open
    setRevealed(open)
    Animated.spring(offset, {
      toValue: open ? -actionsWidth : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start()
  }

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderGrant: () => {
      setRevealed(true)
      dragStart.current = opened.current ? -actionsWidth : 0
    },
    onPanResponderMove: (_, gesture) => {
      offset.setValue(Math.max(-actionsWidth, Math.min(0, dragStart.current + gesture.dx)))
    },
    onPanResponderRelease: (_, gesture) => {
      settle(dragStart.current + gesture.dx < -actionsWidth / 2)
    },
    onPanResponderTerminate: () => settle(opened.current),
  }), [offset, actionsWidth])

  const run = (action: SwipeAction) => {
    settle(false)
    if (!action.confirm) {
      action.onPress()
      return
    }
    Alert.alert(action.confirm.title, action.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action.confirm.confirmLabel,
        style: action.tone === 'destructive' ? 'destructive' : 'default',
        onPress: action.onPress,
      },
    ])
  }

  return (
    <View style={styles.container}>
      <View
        pointerEvents={revealed ? 'auto' : 'none'}
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
        style={[styles.actions, !revealed && { opacity: 0 }]}
      >
        {props.actions.map((action) => {
          const destructive = action.tone === 'destructive'
          const color = destructive ? tokens.colors.destructiveForeground : tokens.colors.foreground
          const Icon = action.icon
          return (
            <Pressable
              key={action.key}
              accessibilityLabel={`${action.label} ${props.subject}`}
              accessibilityRole="button"
              onPress={() => run(action)}
              style={({ pressed }) => [
                styles.action,
                destructive ? styles.destructive : styles.neutral,
                pressed && styles.pressed,
              ]}
            >
              <Icon color={color} size={18} />
              <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <Animated.View style={{ transform: [{ translateX: offset }] }} {...panResponder.panHandlers}>
        <Pressable
          accessibilityActions={[
            { name: 'activate' },
            ...props.actions.map((action) => ({ name: action.key, label: action.label })),
          ]}
          accessibilityRole="button"
          onAccessibilityAction={(event) => {
            const action = props.actions.find((item) => item.key === event.nativeEvent.actionName)
            if (action) run(action)
            else props.onPress()
          }}
          onPress={() => opened.current ? settle(false) : props.onPress()}
        >
          {props.children}
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
    actions: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'stretch',
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    action: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.xs,
      width: ACTION_WIDTH,
    },
    neutral: { backgroundColor: tokens.colors.secondary },
    destructive: { backgroundColor: tokens.colors.destructive },
    actionLabel: { fontSize: tokens.type.meta, fontWeight: '600' },
    pressed: { opacity: 0.75 },
  }), [tokens])
}
