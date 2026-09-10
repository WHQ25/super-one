import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'

/** How long chrome takes to fade in or out of the way of the content. */
export const FADE_MS = 160

/**
 * An opacity that follows a boolean. For overlay chrome that gets out of the
 * way — the preview's title row, its rotate bar — where a hard unmount would
 * blink and would also throw away the layout the next fade-in needs.
 */
export function useFade(visible: boolean, duration = FADE_MS): Animated.Value {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: visible ? 1 : 0, duration, useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [visible, duration, opacity])
  return opacity
}
