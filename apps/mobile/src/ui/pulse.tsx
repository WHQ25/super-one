import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing } from 'react-native'
import { useIconMotion } from './use-icon-motion'

const PULSE_MS = 1_500

/**
 * Opacity breathing on the same motion gate the harness icons use. Slow enough
 * to read as "still waiting" rather than "loading": the strips above the
 * composer use it on a glyph to say the state behind them is live.
 */
export function Pulse(props: { active: boolean; children: ReactNode }) {
  const animate = useIconMotion()
  const opacity = useRef(new Animated.Value(1)).current
  const running = props.active && animate
  useEffect(() => {
    if (!running) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.4, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => {
      loop.stop()
      opacity.setValue(1)
    }
  }, [opacity, running])
  return <Animated.View style={{ opacity }}>{props.children}</Animated.View>
}
