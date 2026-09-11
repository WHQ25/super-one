import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
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
 * The width the painted string needs, beyond the one RN measured.
 *
 * `react-native-svg` lays a string out a few percent wider than RN's own text
 * engine measures it, and a viewport only as wide as the measured box shaves the
 * last glyph. The slack belongs to the SVG viewport alone: reserving it in the
 * layout text pads the chip with a gap the label never fills. So every geometry
 * derived from the paint — viewport, scroll period, mask — is built from this
 * width, while the layout box stays the width of the text.
 * `textLength` would be the exact fix, but react-native-svg drops it in
 * `extractText` before it reaches the native view.
 */
function paintWidth(box: Box, text: string, fontSize: number): number {
  return box.width + text.length * fontSize * 0.05
}

/**
 * react-native-svg's Android text layout (`TSpanView.java`) reads each glyph's
 * kerned advance off the whole line but then subtracts that advance from the
 * *end* position to find the glyph's start, so a kern pair moves the wrong
 * glyph: in `ULTRATHINK` the `L` is pulled back into the `U` by the L–T kern
 * and a hole opens before the `T`. Turning auto-kerning off makes every glyph
 * advance by its own width, which is what RN's own text engine shows. iOS
 * takes its advances from CoreText, kerned and correctly placed, so it keeps
 * the pairs.
 */
const GLYPH_PROPS = Platform.OS === 'android' ? { kerning: 0 } : {}

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
 * The light-mode molten fill: a static ember base under four differently-centred
 * radial gradients cross-fading, so the hot spot travels across the glyphs.
 * Desktop staggers the same four with a negative `animation-delay`; here the
 * stagger is folded into each layer's output curve, off one shared clock.
 *
 * Every run — the ember base included — is SVG text. Mixing the RN layout text
 * in as the base does not work: the two engines space glyphs differently, so
 * the runs land a few pixels apart and the label reads as a doubled smear.
 */
function MoltenFill({ box, fontSize, children }: { box: Box; fontSize: number; children: string }) {
  const sweep = useLoop(FIRE_SWEEP_S * 1000)
  const y = baselineY(box, fontSize)
  const width = paintWidth(box, children, fontSize)
  const radius = Math.hypot(width / 2, box.height * 0.55)
  const glyphs = (fill: string) =>
    <SvgText {...GLYPH_PROPS} x={0} y={y} fontSize={fontSize} fontWeight="600" fill={fill}>{children}</SvgText>
  return <>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={box.height}>{glyphs(FIRE_EMBER)}</Svg>
    </View>
    {FIRE_SWEEP_CENTERS.map(([cx, cy], index) => <Animated.View key={index} pointerEvents="none" style={{
      ...StyleSheet.absoluteFillObject,
      opacity: sweep.interpolate({
        inputRange: SWEEP_SAMPLES,
        outputRange: SWEEP_SAMPLES.map((point) => fireSweepOpacity(point + index / FIRE_SWEEP_CENTERS.length)),
      }),
    }}>
      <Svg width={width} height={box.height}>
        <Defs>
          {/* `r="45%"` would resolve against the glyph bounds, not the box — spell it out. */}
          <RadialGradient id={`fire-${index}`} gradientUnits="userSpaceOnUse"
            cx={width * cx / 100} cy={box.height * cy / 100} r={radius}>
            {FIRE_FILL_STOPS.map(([offset, color]) => <Stop key={offset} offset={offset} stopColor={color} />)}
          </RadialGradient>
        </Defs>
        {glyphs(`url(#fire-${index})`)}
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
    {/* Measures the box, then stops painting so only the SVG runs show — see
        `RainbowText` for why this is `opacity` and not `color: 'transparent'`. */}
    <Text numberOfLines={1} style={{ ...layer, color: FIRE_EMBER, opacity: box ? 0 : 1 }}>{children}</Text>
    {box ? <MoltenFill box={box} fontSize={fontSize}>{children}</MoltenFill> : null}
    {box ? <FireEmbers width={box.width} height={box.height} dark={false} /> : null}
  </View>
}

/** `MODEL · ULTRATHINK`. One palette laid down twice, scrolled by exactly one copy. */
export function RainbowText({ children, fontSize }: { children: string; fontSize: number }) {
  const { tokens: { scheme, colors } } = useMobileTheme()
  const [box, onLayout] = useTextBox()
  const shift = useRef(new Animated.Value(0)).current
  const width = box ? paintWidth(box, children, fontSize) : 0
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
    {/* The layout text has to stay for the box to be measured, but it must stop
        painting once the SVG takes over, or the two runs read as one smeared,
        unreadable label. `color: 'transparent'` does not do it — RN Android
        drops a fully transparent text colour and falls back to the default ink
        — so hide the view instead, which still measures. */}
    <Text numberOfLines={1} style={{ fontSize, fontWeight: '500', color: colors.foreground,
      opacity: box ? 0 : 1 }}>{children}</Text>
    {box ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={box.height}>
        <Defs>
          <LinearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">{stops}</LinearGradient>
          <Mask id="rainbow-mask">
            <SvgText {...GLYPH_PROPS} x={0} y={baselineY(box, fontSize)} fontSize={fontSize} fontWeight="500" fill="#ffffff">{children}</SvgText>
          </Mask>
        </Defs>
        <AnimatedRect x={shift} y={0} width={width * 2} height={box.height} fill="url(#rainbow)" mask="url(#rainbow-mask)" />
      </Svg>
    </View> : null}
  </View>
}
