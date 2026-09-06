import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Mask, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg'
import {
  FIRE_EMBER,
  FIRE_FILL_STOPS,
  FIRE_GOLD,
  FIRE_SWEEP_CENTERS,
  FIRE_SWEEP_S,
  fireSweepOpacity,
  RAINBOW_DARK,
  RAINBOW_LIGHT,
} from '@superone/shared/effort-easter-egg-palette'
import { Text } from './text'
import { FireEmbers } from './fire-embers'
import { useMobileTheme } from '../theme/context'

/**
 * The two Claude effort easter eggs, ported to React Native.
 *
 * The embers are a real particle simulation on a Skia canvas — see
 * `fire-embers`. Everything here is the text underneath them: RN has no text
 * gradients, so the molten fill and the rainbow scroll are drawn with
 * `react-native-svg` over a measured layout box.
 */

const AnimatedRect = Animated.createAnimatedComponent(Rect)

type Box = { width: number; height: number }

/** Lay the string out as normal text first, then paint over the measured box. */
function useTextBox(): [Box | null, (event: LayoutChangeEvent) => void] {
  const [box, setBox] = useState<Box | null>(null)
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    if (!width || !height) return
    setBox((current) => current && current.width === width && current.height === height
      ? current
      : { width, height })
  }
  return [box, onLayout]
}

function useLoop(durationMs: number) {
  const value = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    )
    animation.start()
    return () => { animation.stop(); value.setValue(0) }
  }, [value, durationMs])
  return value
}

function baselineY(box: Box, fontSize: number): number {
  // Cap height sits a little above the middle of a line box.
  return box.height / 2 + fontSize * 0.36
}

/**
 * Desktop stacks three text-shadows per glow layer; RN allows one, so each layer
 * keeps the widest term of `fire-sprite-glow-a` / `-b` in `styles/index.css`.
 * Cross-fading two static layers reproduces the 0.8s shimmer without animating
 * `textShadowRadius`, which would drop the label off the native driver.
 */
const GLOW_LAYERS = [
  { color: '#ff6a00', radius: 8, dy: 0 },
  { color: '#ff8c00', radius: 11, dy: -2 },
]

const SWEEP_SAMPLES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]

/**
 * The light-mode molten fill: four differently-centred radial gradients
 * cross-fading, so the hot spot travels across the glyphs. Desktop staggers the
 * same four with a negative `animation-delay`; here the stagger is folded into
 * each layer's output curve, off one shared clock.
 */
function MoltenFill({ box, fontSize, children }: { box: Box; fontSize: number; children: string }) {
  const sweep = useLoop(FIRE_SWEEP_S * 1000)
  const y = baselineY(box, fontSize)
  const radius = Math.hypot(box.width / 2, box.height * 0.55)
  return <>
    {FIRE_SWEEP_CENTERS.map(([cx, cy], index) => <Animated.View key={index} pointerEvents="none" style={{
      ...StyleSheet.absoluteFillObject,
      opacity: sweep.interpolate({
        inputRange: SWEEP_SAMPLES,
        outputRange: SWEEP_SAMPLES.map((point) => fireSweepOpacity(point + index / FIRE_SWEEP_CENTERS.length)),
      }),
    }}>
      <Svg width={box.width} height={box.height}>
        <Defs>
          {/* `r="45%"` would resolve against the glyph bounds, not the box — spell it out. */}
          <RadialGradient id={`fire-${index}`} gradientUnits="userSpaceOnUse"
            cx={box.width * cx / 100} cy={box.height * cy / 100} r={radius}>
            {FIRE_FILL_STOPS.map(([offset, color]) => <Stop key={offset} offset={offset} stopColor={color} />)}
          </RadialGradient>
        </Defs>
        <SvgText x={0} y={y} fontSize={fontSize} fontWeight="600" fill={`url(#fire-${index})`}>{children}</SvgText>
      </Svg>
    </Animated.View>)}
  </>
}

/** `MODEL · MAX`. Gold under a breathing glow in the dark, molten fill in the light. */
export function FireText({ children, fontSize }: { children: string; fontSize: number }) {
  const { tokens: { scheme } } = useMobileTheme()
  const dark = scheme === 'dark'
  const [box, onLayout] = useTextBox()
  const glow = useLoop(800)
  const layer = { fontSize, fontWeight: '600' as const }

  if (dark) {
    return <View onLayout={onLayout}>
      <Text numberOfLines={1} style={{ ...layer, color: FIRE_GOLD }}>{children}</Text>
      {box ? GLOW_LAYERS.map((shadow, index) => <Animated.View key={index} pointerEvents="none" style={{
        ...StyleSheet.absoluteFillObject,
        opacity: glow.interpolate({ inputRange: [0, 0.5, 1], outputRange: index === 0 ? [1, 0, 1] : [0, 1, 0] }),
      }}>
        <Text numberOfLines={1} style={{
          ...layer, color: FIRE_GOLD,
          textShadowColor: shadow.color,
          textShadowOffset: { width: 0, height: shadow.dy },
          textShadowRadius: shadow.radius,
        }}>{children}</Text>
      </Animated.View>) : null}
      {box ? <FireEmbers width={box.width} height={box.height} dark /> : null}
    </View>
  }

  return <View onLayout={onLayout}>
    <Text numberOfLines={1} style={{ ...layer, color: FIRE_EMBER }}>{children}</Text>
    {box ? <MoltenFill box={box} fontSize={fontSize}>{children}</MoltenFill> : null}
    {box ? <FireEmbers width={box.width} height={box.height} dark={false} /> : null}
  </View>
}

/** `MODEL · ULTRATHINK`. One palette laid down twice, scrolled by exactly one copy. */
export function RainbowText({ children, fontSize }: { children: string; fontSize: number }) {
  const { tokens: { scheme, colors } } = useMobileTheme()
  const [box, onLayout] = useTextBox()
  const shift = useRef(new Animated.Value(0)).current
  const width = box?.width ?? 0
  useEffect(() => {
    if (!width) return
    shift.setValue(0)
    const animation = Animated.loop(
      Animated.timing(shift, { toValue: -width, duration: 2000, easing: Easing.linear, useNativeDriver: false }),
    )
    animation.start()
    return () => { animation.stop() }
  }, [shift, width])

  const palette = scheme === 'dark' ? RAINBOW_DARK : RAINBOW_LIGHT
  // Two copies across the doubled rect: sliding by one copy lands on an
  // identical frame, so the loop has no seam.
  const stops = palette.flatMap((color, index) => {
    const step = index / (palette.length - 1) / 2
    return [
      <Stop key={`a${index}`} offset={step} stopColor={color} />,
      <Stop key={`b${index}`} offset={0.5 + step} stopColor={color} />,
    ]
  })

  return <View onLayout={onLayout}>
    <Text numberOfLines={1} style={{ fontSize, fontWeight: '500', color: box ? 'transparent' : colors.foreground }}>{children}</Text>
    {box ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={box.width} height={box.height}>
        <Defs>
          <LinearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">{stops}</LinearGradient>
          <Mask id="rainbow-mask">
            <SvgText x={0} y={baselineY(box, fontSize)} fontSize={fontSize} fontWeight="500" fill="#ffffff">{children}</SvgText>
          </Mask>
        </Defs>
        <AnimatedRect x={shift} y={0} width={box.width * 2} height={box.height} fill="url(#rainbow)" mask="url(#rainbow-mask)" />
      </Svg>
    </View> : null}
  </View>
}
