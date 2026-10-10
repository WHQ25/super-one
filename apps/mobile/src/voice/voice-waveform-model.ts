/** The approved thin-wave preview parameters. */
export const VOICE_WAVEFORM = { speed: 1.6, amplitude: 1.3, glow: 0.4, height: 36 } as const

/** A small noise gate and speech-scale gain, applied to native linear RMS. */
export function normalizedVoiceAudioLevel(rms: number): number {
  'worklet'
  return Number.isFinite(rms) ? Math.max(0, Math.min(1, (rms - 0.008) / 0.15)) : 0
}

/** Flow supplies phase only; actual audio supplies all vertical movement. */
export function voiceWaveY(u: number, seconds: number, level: number, layer: number): number {
  'worklet'
  const t = seconds * VOICE_WAVEFORM.speed
  const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.66)
  const amplitude = Math.min(10.2, 8.4 * VOICE_WAVEFORM.amplitude) * Math.max(0, Math.min(1, level))
  const wave = 0.84 * Math.sin(u * Math.PI * 2 * (1.85 + layer * 0.12) - t * 2.6 + layer * 1.25)
    + 0.16 * Math.sin(u * Math.PI * 2 * 4.1 - t * 3.1 + layer)
  return VOICE_WAVEFORM.height / 2 + envelope * wave * amplitude
}
