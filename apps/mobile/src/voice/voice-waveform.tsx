import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { BlurMask, Canvas, LinearGradient, Path, Skia, useClock, vec, type SkPath } from '@shopify/react-native-skia'
import { useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { ULTRATHINK_COLORS, ULTRATHINK_SHIMMER_COLORS, type Rgb } from '@superone/shared/composer-mode'
import { useMobileTheme } from '../theme/context'
import { useIconMotion } from '../ui/use-icon-motion'
import { SILENT_VOICE_LEVELS, type VoiceAudioLevelSource } from './voice-audio-levels'
import { normalizedVoiceAudioLevel, voiceWaveY, VOICE_WAVEFORM } from './voice-waveform-model'

const COLORS = ULTRATHINK_COLORS.map(([r, g, b]) => `rgb(${r},${g},${b})`)
type Meters = { input: SharedValue<number>; output: SharedValue<number> }
type WaveProps = Meters & { width: number; shimmer: readonly Rgb[] }

export function VoiceWaveform({ levels, compact = false, paused = false }: { levels?: VoiceAudioLevelSource; compact?: boolean; paused?: boolean }) {
  // Canvas has its own React root: read RN context here and pass plain values in.
  const { tokens: { scheme, colors } } = useMobileTheme()
  const shimmer = ULTRATHINK_SHIMMER_COLORS[scheme]
  const input = useSharedValue(0); const output = useSharedValue(0)
  const [width, setWidth] = useState(0)
  const moving = useIconMotion()
  useEffect(() => {
    const publish = (sample: ReturnType<VoiceAudioLevelSource['snapshot']>) => {
      const mic = paused ? 0 : normalizedVoiceAudioLevel(sample.input)
      const speaker = paused ? 0 : normalizedVoiceAudioLevel(sample.output)
      input.value = withTiming(mic, { duration: mic > input.value ? 60 : 180 })
      output.value = withTiming(speaker, { duration: speaker > output.value ? 60 : 180 })
    }
    publish(levels?.snapshot() ?? SILENT_VOICE_LEVELS)
    return levels?.subscribe(publish)
  }, [levels, input, output, paused])
  return <View testID="mobile-voice-waveform" pointerEvents="none" style={compact
    ? { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }
    : { flex: 1, height: VOICE_WAVEFORM.height }}
    onLayout={({ nativeEvent: { layout } }) => setWidth(current => current === layout.width ? current : layout.width)}>
    {width > 4 ? <Canvas pointerEvents="none" style={{ width, height: VOICE_WAVEFORM.height, top: compact ? -2 : 0 }}>
      {moving && !paused ? <MovingWaves width={width} input={input} output={output} shimmer={shimmer} /> : <Waves width={width} input={input} output={output} shimmer={shimmer} />}
    </Canvas> : null}
  </View>
}

function MovingWaves(props: WaveProps) {
  const clock = useClock()
  return <Waves {...props} clock={clock} />
}

function makeWave(width: number, seconds: number, level: number, layer: number): SkPath {
  'worklet'
  const path = Skia.Path.Make()
  const points = Math.min(180, Math.ceil(width))
  for (let index = 0; index <= points; index++) {
    const u = index / points
    const x = 2 + u * (width - 4)
    const y = voiceWaveY(u, seconds, level, layer)
    if (index === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  return path
}

function Waves({ width, input, output, shimmer, clock }: WaveProps & { clock?: SharedValue<number> }) {
  const glint = useDerivedValue(() => {
    const t = (clock?.value ?? 800) / 1000 * VOICE_WAVEFORM.speed
    const center = (t * 0.16) % 1.7 - 0.35
    return shimmer.map(([r, g, b], index) => {
      const alpha = Math.exp(-Math.pow((index / 6 - center) / 0.13, 2))
      return `rgba(${r},${g},${b},${alpha})`
    })
  })
  return <>{[3, 2, 1, 0].map(layer => <WaveLayer key={layer} width={width} layer={layer}
    input={input} output={output} clock={clock} glint={glint} />)}</>
}

function WaveLayer({ width, layer, input, output, clock, glint }: Meters & {
  width: number; layer: number; clock?: SharedValue<number>; glint: SharedValue<string[]>
}) {
  const rest = useMemo(() => makeWave(width, 0, 0, layer), [width, layer])
  const path = useDerivedValue(() => {
    const level = Math.max(input.value, output.value)
    return level < 0.001 ? rest : makeWave(width, (clock?.value ?? 800) / 1000, level, layer)
  })
  const glintOpacity = useDerivedValue(() => Math.max(input.value, output.value) < 0.001 ? 0 : 0.8)
  const opacity = layer === 0 ? 0.95 : 0.28 + layer * 0.12
  const strokeWidth = layer === 0 ? 1.9 : 1.2
  const gradient = <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={COLORS} />
  return <>
    <Path path={path} style="stroke" strokeWidth={strokeWidth} strokeCap="round" strokeJoin="round" opacity={opacity * 0.6}>
      {gradient}<BlurMask blur={VOICE_WAVEFORM.glow * 5} style="normal" />
    </Path>
    <Path path={path} style="stroke" strokeWidth={strokeWidth} strokeCap="round" strokeJoin="round" opacity={opacity}>{gradient}</Path>
    {layer === 0 ? <Path path={path} style="stroke" strokeWidth={2.4} strokeCap="round" opacity={glintOpacity}>
      <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={glint} />
    </Path> : null}
  </>
}
