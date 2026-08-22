import { describe, expect, it } from 'vitest'
import type { ScrcpyMediaPacket } from './scrcpy-protocol'
import { AndroidVideoStream } from './video-frames'

/** Captured off this repo's AVD — SPS then PPS, Baseline 4.1. */
const PARAMETER_SETS = Buffer.from(
  '000000016742c0298d680900a1a420202020f08846a00000000168ce01a835c8',
  'hex',
)
/** An IDR as scrcpy actually sends it: no SPS in front of it. */
const KEYFRAME = Buffer.from('0000000165b80004059f', 'hex')
const DELTA = Buffer.from('0000000161e000201c70', 'hex')

function packet(over: Partial<ScrcpyMediaPacket>): ScrcpyMediaPacket {
  return { kind: 'media', config: false, keyframe: false, timestampUs: 0, data: DELTA, ...over }
}

const context = { sessionId: 's', screen: { width: 720, height: 1600 }, timestampMs: 1 }

describe('AndroidVideoStream', () => {
  it('reads the codec off the config packet instead of assuming one', () => {
    const stream = new AndroidVideoStream()
    const frame = stream.frame(packet({ config: true, data: PARAMETER_SETS }), context)
    expect(frame.codec).toBe('avc1.42c029')
    expect(frame.codecConfig).toBe(true)
  })

  it('keeps announcing that codec on the frames that follow', () => {
    const stream = new AndroidVideoStream()
    stream.frame(packet({ config: true, data: PARAMETER_SETS }), context)
    expect(stream.frame(packet({ keyframe: true, data: KEYFRAME }), context).codec).toBe('avc1.42c029')
  })

  it('stamps the parameter sets onto every keyframe', () => {
    const stream = new AndroidVideoStream()
    stream.frame(packet({ config: true, data: PARAMETER_SETS }), context)
    const first = stream.frame(packet({ keyframe: true, data: KEYFRAME }), context)
    const second = stream.frame(packet({ keyframe: true, data: KEYFRAME }), context)
    // Not just the first one: a decoder rebuilt mid-stream has to recover on the next
    // keyframe, and scrcpy sends no second config packet for it to recover from.
    for (const frame of [first, second]) {
      expect(Buffer.from(frame.data)).toEqual(Buffer.concat([PARAMETER_SETS, KEYFRAME]))
    }
  })

  it('leaves delta frames alone', () => {
    const stream = new AndroidVideoStream()
    stream.frame(packet({ config: true, data: PARAMETER_SETS }), context)
    expect(Buffer.from(stream.frame(packet({}), context).data)).toEqual(DELTA)
  })

  it('adopts the parameter sets a rotation re-announces', () => {
    const stream = new AndroidVideoStream()
    stream.frame(packet({ config: true, data: PARAMETER_SETS }), context)
    const rotated = Buffer.from('0000000167640028ffe100', 'hex')
    stream.frame(packet({ config: true, data: rotated }), context)
    const frame = stream.frame(packet({ keyframe: true, data: KEYFRAME }), context)
    expect(frame.codec).toBe('avc1.640028')
    expect(Buffer.from(frame.data)).toEqual(Buffer.concat([rotated, KEYFRAME]))
  })

  it('numbers frames in arrival order and carries the capture geometry', () => {
    const stream = new AndroidVideoStream()
    expect(stream.frame(packet({}), context).sequence).toBe(0)
    const next = stream.frame(packet({}), context)
    expect(next.sequence).toBe(1)
    expect(next.codedWidth).toBe(720)
    expect(next.codedHeight).toBe(1600)
  })
})
