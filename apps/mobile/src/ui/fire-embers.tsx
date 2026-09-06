import { useMemo } from 'react'
import { BlendMode, Canvas, Picture, Skia, useClock } from '@shopify/react-native-skia'
import { useDerivedValue } from 'react-native-reanimated'
import {
  CORE_ALPHA,
  HALO_ALPHA,
  HALO_RADIUS,
  PERIOD_STEPS,
  PHYS_HZ,
} from '@superone/shared/fire-particles'
import { DARK_COLORS, LIGHT_COLORS } from '@superone/shared/effort-easter-egg-palette'
import { buildFireTrajectories } from '../fire-sim'

/**
 * The embers under `MODEL · MAX`, drawn with Skia in immediate mode.
 *
 * This is the same fire as the desktop sprite strip and the old Flutter
 * `CustomPainter`: a halo at `HALO_RADIUS`x the core under a bright core, both
 * additively blended so overlapping particles compound towards white-hot.
 * `BlendMode.Plus` is the whole reason this needs a real canvas — RN views
 * composite with plain alpha, where overlaps only ever get muddier.
 *
 * The trajectories are resolved once on the JS thread; the draw loop runs on
 * the UI thread and only reads them, so the fire never competes with streaming.
 */

/** Room around the label for particles that have risen out of the text box. */
const PAD = 14

export function FireEmbers({ width, height, dark }: { width: number; height: number; dark: boolean }) {
  const fire = useMemo(() => buildFireTrajectories(width, height, dark), [width, height, dark])
  // Flattened so the worklet can index the ramp without an array of arrays.
  const ramp = useMemo(() => Float32Array.from((dark ? DARK_COLORS : LIGHT_COLORS).flat()), [dark])
  const clock = useClock()
  const recorder = useMemo(() => Skia.PictureRecorder(), [])
  const paint = useMemo(() => {
    const value = Skia.Paint()
    value.setAntiAlias(true)
    return value
  }, [])
  const canvasW = width + PAD * 2
  const canvasH = height + PAD * 2

  const picture = useDerivedValue(() => {
    'worklet'
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, canvasW, canvasH))
    // Light mode draws normally; on a pale surface additive blending just
    // washes the embers out, which is the same call desktop makes.
    paint.setBlendMode(dark ? BlendMode.Plus : BlendMode.SrcOver)
    const step = Math.floor((clock.value / 1000) * PHYS_HZ) % PERIOD_STEPS
    const stops = ramp.length / 3 - 1

    for (let index = 0; index < fire.count; index++) {
      const life = fire.lifeSteps[index]
      const age = (step - fire.spawnStep[index] + PERIOD_STEPS) % PERIOD_STEPS
      if (age >= life) continue

      const t = age / life
      const at = fire.offset[index] + age
      const cx = PAD + fire.x[at]
      const cy = PAD + fire.y[at]

      // lerpColor, inlined: a worklet cannot call back into the JS module.
      const scaled = t * stops
      const low = Math.min(Math.floor(scaled), stops - 1)
      const f = scaled - low
      const a = low * 3
      const b = a + 3
      const red = ramp[a] + (ramp[b] - ramp[a]) * f
      const green = ramp[a + 1] + (ramp[b + 1] - ramp[a + 1]) * f
      const blue = ramp[a + 2] + (ramp[b + 2] - ramp[a + 2]) * f

      const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9
      const radius = fire.size[index] * (1 - t * 0.5)

      paint.setColor(Float32Array.of(red / 255, green / 255, blue / 255, alpha * HALO_ALPHA))
      canvas.drawCircle(cx, cy, radius * HALO_RADIUS, paint)
      paint.setColor(Float32Array.of(red / 255, green / 255, blue / 255, alpha * CORE_ALPHA))
      canvas.drawCircle(cx, cy, radius, paint)
    }
    return recorder.finishRecordingAsPicture()
  })

  return <Canvas pointerEvents="none" style={{ position: 'absolute', left: -PAD, top: -PAD, width: canvasW, height: canvasH }}>
    <Picture picture={picture} />
  </Canvas>
}
