import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native'
import { ChevronDown } from 'lucide-react-native'

export function RotatingChevron(props: {
  open: boolean
  color: string
  size?: number
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
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  return <Animated.View pointerEvents="none" style={[props.style, { transform: [{ rotate }] }]}>
    <ChevronDown size={props.size ?? 14} color={props.color} />
  </Animated.View>
}
