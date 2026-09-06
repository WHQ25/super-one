import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Animated, Easing, View, type ViewStyle } from 'react-native'
import { SvgXml } from 'react-native-svg'
import data from './harness-scenes.generated.json'
import type { HarnessSceneData, IconScene, IconMotion } from './harness-scene-types'
import { motionTracks } from './harness-motion'

export const harnessScenes = data as unknown as HarnessSceneData

function Motion({ motion, size, enabled, children, origin }: { motion: IconMotion; size: number; enabled: boolean; children: ReactNode; origin?: string }) {
  const phase = useRef(new Animated.Value(0)).current
  useEffect(() => {
    phase.setValue(0)
    if (!enabled) return
    const easing = motion.easing === 'ease-in-out' ? Easing.bezier(0.42, 0, 0.58, 1) : Easing.linear
    const cycle = Animated.loop(Animated.sequence(motion.frames.slice(1).map((frame, index) => Animated.timing(phase, {
      toValue: frame.at, duration: (frame.at - motion.frames[index]!.at) * motion.duration,
      easing, useNativeDriver: true, isInteraction: false,
    }))))
    cycle.start()
    return () => cycle.stop()
  }, [motion, enabled, phase])
  const style = useMemo(() => {
    const result: Record<string, unknown> = {}, transform: Record<string, unknown>[] = []
    for (const track of motionTracks(motion, size)) {
      const value = phase.interpolate({ inputRange: track.inputRange, outputRange: track.property === 'rotate' ? track.outputRange.map((angle) => `${angle}deg`) : track.outputRange })
      if (track.property === 'opacity') result.opacity = value
      else transform.push({ [track.property]: value })
    }
    if (transform.length) result.transform = transform
    return result as Animated.WithAnimatedObject<ViewStyle>
  }, [motion, size, phase, enabled])
  return <Animated.View pointerEvents="none" style={[{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', transformOrigin: origin }, style]}>{children}</Animated.View>
}

function intrinsicSize(node: IconScene, dimension: 'width' | 'height', size: number): number | undefined {
  const value = node.style[dimension]
  if (typeof value === 'number') return value
  if (typeof value === 'object') return value.multiplier * size + value.offset
  const lengths = node.children?.filter((child) => child.style.position !== 'absolute')
    .map((child) => intrinsicSize(child, dimension, size)).filter((length): length is number => length != null) ?? []
  return lengths.length ? Math.max(...lengths) : undefined
}

export const HarnessScene = memo(function HarnessScene({ node, size, color, background, motion }: {
  node: IconScene; size: number; color: string; background: string; motion: boolean
}) {
  const style: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.style)) {
    if (key === 'color') continue
    style[key] = typeof value === 'object' ? value.multiplier * size + value.offset : value === '$background' ? background : value
  }
  if (style.width == null && !(style.left != null && style.right != null)) style.width = intrinsicSize(node, 'width', size)
  if (style.height == null && !(style.top != null && style.bottom != null)) style.height = intrinsicSize(node, 'height', size)
  const ink = typeof node.style.color === 'string' ? node.style.color : color
  let content: ReactNode = node.xml
    ? <SvgXml xml={node.xml} width="100%" height="100%" color={ink} accessible={false} />
    : node.children?.map((child, index) => <HarnessScene key={index} node={child} size={size} color={ink} background={background} motion={motion} />)
  if (node.animations.length && style.backgroundColor) {
    content = <><View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: style.backgroundColor as string, borderRadius: style.borderRadius as number }} />{content}</>
    delete style.backgroundColor
  }
  // Scene boxes own positioning; motion wrappers only transform their contents.
  for (const name of [...node.animations].reverse()) {
    const profile = harnessScenes.motions[name]
    if (profile) content = <Motion motion={profile} size={size} enabled={motion} origin={style.transformOrigin as string | undefined} key={name}>{content}</Motion>
  }
  return <View pointerEvents="none" style={style as ViewStyle}>{content}</View>
})
