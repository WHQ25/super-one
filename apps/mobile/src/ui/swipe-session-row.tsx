import { useMemo, useRef, type ReactNode } from 'react'
import { Archive, Trash2 } from 'lucide-react-native'
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useMobileTheme } from '../theme/context'

const ACTION_WIDTH = 76
const ACTIONS_WIDTH = ACTION_WIDTH * 2

export function SwipeSessionRow(props: {
  title: string
  children: ReactNode
  onPress: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  const offset = useRef(new Animated.Value(0)).current
  const opened = useRef(false)
  const dragStart = useRef(0)

  const settle = (open: boolean) => {
    opened.current = open
    Animated.spring(offset, {
      toValue: open ? -ACTIONS_WIDTH : 0,
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
      dragStart.current = opened.current ? -ACTIONS_WIDTH : 0
    },
    onPanResponderMove: (_, gesture) => {
      offset.setValue(Math.max(-ACTIONS_WIDTH, Math.min(0, dragStart.current + gesture.dx)))
    },
    onPanResponderRelease: (_, gesture) => {
      settle(dragStart.current + gesture.dx < -ACTIONS_WIDTH / 2)
    },
    onPanResponderTerminate: () => settle(opened.current),
  }), [offset])

  const confirmDelete = () => {
    settle(false)
    Alert.alert(
      'Delete session?',
      `“${props.title || 'Untitled'}” and its local transcript will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: props.onDelete },
      ],
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Archive ${props.title || 'session'}`}
          accessibilityRole="button"
          onPress={() => {
            settle(false)
            props.onArchive()
          }}
          style={({ pressed }) => [styles.action, styles.archive, pressed && styles.pressed]}
        >
          <Archive color={tokens.colors.primaryForeground} size={18} />
          <Text style={styles.actionLabel}>Archive</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Delete ${props.title || 'session'}`}
          accessibilityRole="button"
          onPress={confirmDelete}
          style={({ pressed }) => [styles.action, styles.remove, pressed && styles.pressed]}
        >
          <Trash2 color={tokens.colors.primaryForeground} size={18} />
          <Text style={styles.actionLabel}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX: offset }] }} {...panResponder.panHandlers}>
        <Pressable
          accessibilityActions={[{ name: 'activate' }, { name: 'archive' }, { name: 'delete' }]}
          accessibilityRole="button"
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'archive') props.onArchive()
            else if (event.nativeEvent.actionName === 'delete') confirmDelete()
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
    archive: { backgroundColor: tokens.colors.warning },
    remove: { backgroundColor: tokens.colors.error },
    actionLabel: {
      color: tokens.colors.primaryForeground,
      fontSize: tokens.type.meta,
      fontWeight: '600',
    },
    pressed: { opacity: 0.75 },
  }), [tokens])
}
