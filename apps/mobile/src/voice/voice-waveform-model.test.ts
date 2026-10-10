import { expect, it } from 'vitest'
import { normalizedVoiceAudioLevel, voiceWaveY, VOICE_WAVEFORM } from './voice-waveform-model'

it('stays flat for silent input/output regardless of animation time', () => {
  for (const time of [0, 0.2, 2, 100]) for (const u of [0, 0.2, 0.5, 0.8, 1]) for (let layer = 0; layer < 4; layer++) {
    expect(voiceWaveY(u, time, normalizedVoiceAudioLevel(0), layer)).toBe(VOICE_WAVEFORM.height / 2)
  }
})

it('makes louder audio drive greater displacement while keeping every line inside the composer', () => {
  const center = VOICE_WAVEFORM.height / 2
  expect(Math.abs(voiceWaveY(0.4, 0.5, normalizedVoiceAudioLevel(0.1), 0) - center))
    .toBeGreaterThan(Math.abs(voiceWaveY(0.4, 0.5, normalizedVoiceAudioLevel(0.02), 0) - center))
  for (let layer = 0; layer < 4; layer++) for (let index = 0; index <= 100; index++) {
    const y = voiceWaveY(index / 100, 1, 1, layer)
    expect(y).toBeGreaterThan(4)
    expect(y).toBeLessThan(VOICE_WAVEFORM.height - 4)
  }
  expect(normalizedVoiceAudioLevel(NaN)).toBe(0)
  expect(normalizedVoiceAudioLevel(Infinity)).toBe(0)
})
