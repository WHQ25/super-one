import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native'
import { ChevronDown, type LucideIcon } from 'lucide-react-native'

export function RotatingChevron(props: {
  open: boolean
  color: string
  size?: number
  /** A dropdown trigger flips its chevron; a disclosure row turns it a quarter. */
  icon?: LucideIcon
  degrees?: number
  style?: StyleProp<ViewStyle>
}) {
  const progress = useRef(new Animated.Value(props.open ? 1 : 0)).current
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: props.open ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, props.open])
  const Icon = props.icon ?? ChevronDown
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${props.degrees ?? 180}deg`] })
  return <Animated.View pointerEvents="none" style={[props.style, { transform: [{ rotate }] }]}>
    <Icon size={props.size ?? 14} color={props.color} />
  </Animated.View>
}
