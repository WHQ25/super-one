import { describe, expect, it } from 'vitest'
import { DOUBAO_PLAYBACK_AUDIBLE_RMS, DOUBAO_PLAYBACK_BARGE_RMS, nextPlaybackBarge } from './pcm-voice-playback'

describe('playback barge', () => {
  it('clears queued audio after the mic stays loud for 600 ms', () => {
    let hits = 0
    for (let batch = 0; batch < 5; batch += 1) {
      const step = nextPlaybackBarge(hits, DOUBAO_PLAYBACK_BARGE_RMS, DOUBAO_PLAYBACK_AUDIBLE_RMS)
      expect(step.drop).toBe(false)
      hits = step.hits
    }
    expect(hits).toBe(5)
    expect(nextPlaybackBarge(hits, 0.2, 0.1)).toEqual({ hits: 0, drop: true })
  })

  it('ignores a loud mic when nothing is playing, and a quiet mic while audio remains', () => {
    expect(nextPlaybackBarge(1, DOUBAO_PLAYBACK_BARGE_RMS, 0)).toEqual({ hits: 0, drop: false })
    expect(nextPlaybackBarge(1, 0.01, 0.2)).toEqual({ hits: 0, drop: false })
  })
})
