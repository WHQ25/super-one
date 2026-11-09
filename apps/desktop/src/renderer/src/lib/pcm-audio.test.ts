import { expect, it } from 'vitest'
import { floatToS16le, pcmRms, s16leToFloat } from './pcm-audio'

it('round-trips silence and full-scale samples as little-endian pcm', () => {
  const pcm = floatToS16le(new Float32Array([0, 1, -1]))
  expect([...pcm]).toEqual([0, 0, 255, 127, 0, 128])
  const floats = s16leToFloat(pcm)
  expect(floats[0]).toBe(0)
  expect(floats[1]).toBeCloseTo(1, 4)
  expect(floats[2]).toBeCloseTo(-1, 4)
})

it('measures loudness from the captured floats', () => {
  expect(pcmRms(new Float32Array())).toBe(0)
  expect(pcmRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
})
