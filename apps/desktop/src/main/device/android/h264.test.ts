import { describe, expect, it } from 'vitest'
import { h264CodecString } from './h264'

/** Captured off this repo's AVD: the config packet scrcpy sends before its first frame. */
const CONFIG_PACKET = Buffer.from(
  '000000016742c0298d680900a1a420202020f08846a00000000168ce01a835c8',
  'hex',
)

describe('h264CodecString', () => {
  it('reads the profile and level a real scrcpy config packet declares', () => {
    // Baseline (0x42), constraint flags 0xc0, level 4.1 (0x29) — NOT the High profile
    // the renderer used to assume, which is exactly why this is read and not written.
    expect(h264CodecString(CONFIG_PACKET)).toBe('avc1.42c029')
  })

  it('finds the SPS behind a 3-byte start code too', () => {
    expect(h264CodecString(Buffer.from('0000016764001fac', 'hex'))).toBe('avc1.64001f')
  })

  it('skips NAL units that are not an SPS', () => {
    // A PPS on its own says nothing about the profile.
    expect(h264CodecString(Buffer.from('0000000168ce01a835c8', 'hex'))).toBeNull()
  })

  it('declines bytes that hold no NAL unit at all', () => {
    expect(h264CodecString(Buffer.from('deadbeef', 'hex'))).toBeNull()
  })
})
