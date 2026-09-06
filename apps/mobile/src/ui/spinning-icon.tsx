import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react-native'
import { Animated, Easing } from 'react-native'
import { useIconMotion } from './use-icon-motion'

const SPIN_DURATION_MS = 1_100

/**
 * A lucide icon rotating at a steady rate. Follows the same motion gate as the
 * harness icons: it stops while the app is backgrounded and stays at its first
 * frame under Reduce Motion, so a screenshot is deterministic.
 */
export function SpinningIcon(props: {
  icon: LucideIcon
  size: number
  color: string
  strokeWidth?: number
}) {
  const animate = useIconMotion()
  const spin = useRef(new Animated.Value(0)).current
  const Icon = props.icon

  useEffect(() => {
    if (!animate) return
    const loop = Animated.loop(Animated.timing(spin, {
      toValue: 1,
      duration: SPIN_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }))
    loop.start()
    return () => {
      loop.stop()
      spin.setValue(0)
    }
  }, [animate, spin])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon color={props.color} size={props.size} strokeWidth={props.strokeWidth} />
    </Animated.View>
  )
}
