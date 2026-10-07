import { useMemo, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { BlurMask, Canvas, Group, Path, RoundedRect, Skia, SweepGradient, useClock, vec, type SkPath } from '@shopify/react-native-skia'
import { interpolate, useDerivedValue, type SharedValue } from 'react-native-reanimated'
import {
  COMPOSER_MODE_SPARKLE_COLORS,
  COMPOSER_MODE_SPARKLE_KEYFRAMES,
  COMPOSER_MODE_SPARKLES,
  COMPOSER_MODE_TURN_S,
  composerModeRing,
  type ComposerMode,
  type Rgb,
} from '@superone/shared/composer-mode'
import { useMobileTheme } from '../theme/context'
import { useIconMotion } from './use-icon-motion'

/**
 * The composer border while the next turn runs in a special mode, ported from
 * the desktop's `ComposerModeBorder`: the mode's colours turning around the
 * box with a soft halo, and for the multi-agent modes sparkles twinkling on
 * the edge. RN has no conic gradient or CSS mask, so it is a Skia sweep
 * gradient stroked along the box; the clock runs on the UI thread, and the
 * whole canvas stands still under Reduce Motion or in the background.
 *
 * Sits under the box as an earlier sibling filling the same frame, with the
 * box's own border made transparent; the halo and sparkles bleed `BLEED`
 * past it, so no ancestor may clip.
 */

/** Room past the box for the halo's blur and the sparkles centred on its edge. */
const BLEED = 14
/** The ring and halo as the desktop draws them: the box's outer 1.5px, and its outer 3px blurred 6px at 60%. */
const RING_WIDTH = 1.5
const HALO_WIDTH = 3
const HALO_BLUR = 6
const HALO_OPACITY = 0.6
/** Box perimeter per sparkle: the desktop's 20 sit around a ~1400px composer; a phone's gets fewer. */
const SPARKLE_SPACING = 72

const KEY_AT = [...COMPOSER_MODE_SPARKLE_KEYFRAMES.at]
const KEY_SCALE = [...COMPOSER_MODE_SPARKLE_KEYFRAMES.scale]
const KEY_ROTATE = COMPOSER_MODE_SPARKLE_KEYFRAMES.rotateDeg.map((deg) => (deg * Math.PI) / 180)
const KEY_OPACITY = [...COMPOSER_MODE_SPARKLE_KEYFRAMES.opacity]

const rgb = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`

/** The desktop's four-point star (`clip-path` polygon), centred on the origin. */
function starPath(size: number): SkPath {
  const points: Array<[number, number]> = [[0.5, 0], [0.61, 0.39], [1, 0.5], [0.61, 0.61], [0.5, 1], [0.39, 0.61], [0, 0.5], [0.39, 0.39]]
  const path = Skia.Path.Make()
  points.forEach(([x, y], index) => {
    const px = (x - 0.5) * size
    const py = (y - 0.5) * size
    if (index === 0) path.moveTo(px, py)
    else path.lineTo(px, py)
  })
  path.close()
  return path
}

type Box = { width: number; height: number }
type Turn = SharedValue<Array<{ rotate: number }>> | Array<{ rotate: number }>

export function ComposerModeBorder({ mode, radius }: { mode: ComposerMode; radius: number }) {
  const [box, setBox] = useState<Box | null>(null)
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    if (!width || !height) return
    setBox((current) => current && current.width === width && current.height === height ? current : { width, height })
  }
  return <View testID="composer-mode-border" pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
    {box ? <ModeCanvas mode={mode} radius={radius} box={box} /> : null}
  </View>
}

function ModeCanvas({ mode, radius, box }: { mode: ComposerMode; radius: number; box: Box }) {
  const { tokens: { scheme } } = useMobileTheme()
  const dark = scheme === 'dark'
  const moving = useIconMotion()
  const colors = useMemo(() => composerModeRing(mode, dark).map(rgb), [mode, dark])
  const sparkle = COMPOSER_MODE_SPARKLE_COLORS[mode]?.[dark ? 'dark' : 'light']
  return <Canvas pointerEvents="none" style={{ position: 'absolute', left: -BLEED, top: -BLEED, width: box.width + BLEED * 2, height: box.height + BLEED * 2 }}>
    {moving
      ? <TurningRing box={box} radius={radius} colors={colors} sparkle={sparkle ? rgb(sparkle) : null} />
      : <Ring box={box} radius={radius} colors={colors} turn={[{ rotate: 0 }]} />}
  </Canvas>
}

function TurningRing({ box, radius, colors, sparkle }: { box: Box; radius: number; colors: string[]; sparkle: string | null }) {
  const clock = useClock()
  const turn = useDerivedValue(() => [{ rotate: ((clock.value / 1000 / COMPOSER_MODE_TURN_S) % 1) * Math.PI * 2 }])
  const sparkles = useMemo(() => {
    const perimeter = (box.width + box.height) * 2
    const step = Math.max(1, Math.round(COMPOSER_MODE_SPARKLES.length / (perimeter / SPARKLE_SPACING)))
    return COMPOSER_MODE_SPARKLES.filter((_, index) => index % step === 0)
  }, [box.width, box.height])
  return <>
    <Ring box={box} radius={radius} colors={colors} turn={turn} />
    {sparkle ? sparkles.map((spot, index) => <Sparkle key={index} clock={clock} color={sparkle}
      x={BLEED + spot.x * box.width} y={BLEED + spot.y * box.height} size={spot.size} period={spot.period} delay={spot.delay} />) : null}
  </>
}

/** The halo under the ring, both stroked inside the box's outer edge with one turning sweep. */
function Ring({ box, radius, colors, turn }: { box: Box; radius: number; colors: string[]; turn: Turn }) {
  const center = vec(BLEED + box.width / 2, BLEED + box.height / 2)
  const stroke = (width: number) => ({
    x: BLEED + width / 2, y: BLEED + width / 2,
    width: box.width - width, height: box.height - width,
    r: Math.max(0, radius - width / 2),
    style: 'stroke' as const, strokeWidth: width,
  })
  return <>
    <RoundedRect {...stroke(HALO_WIDTH)} opacity={HALO_OPACITY}>
      <SweepGradient c={center} colors={colors} origin={center} transform={turn} />
      <BlurMask blur={HALO_BLUR} style="normal" />
    </RoundedRect>
    <RoundedRect {...stroke(RING_WIDTH)}>
      <SweepGradient c={center} colors={colors} origin={center} transform={turn} />
    </RoundedRect>
  </>
}

function Sparkle({ clock, color, x, y, size, period, delay }: {
  clock: SharedValue<number>; color: string; x: number; y: number; size: number; period: number; delay: number
}) {
  const path = useMemo(() => starPath(size), [size])
  // A negative CSS `animation-delay` is a head start: the twinkle began `-delay` seconds ago.
  const phase = useDerivedValue(() => (((clock.value / 1000 - delay) / period) % 1 + 1) % 1)
  const transform = useDerivedValue(() => [
    { translateX: x },
    { translateY: y },
    { rotate: interpolate(phase.value, KEY_AT, KEY_ROTATE) },
    { scale: interpolate(phase.value, KEY_AT, KEY_SCALE) },
  ])
  const opacity = useDerivedValue(() => interpolate(phase.value, KEY_AT, KEY_OPACITY))
  return <Group transform={transform} opacity={opacity}>
    <Path path={path} color={color} />
  </Group>
}
