import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceFrameRenderer, preferredDevicePreviewMode } from './device-video'

describe('preferredDevicePreviewMode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses H.264 when WebCodecs is available', () => {
    vi.stubGlobal('VideoDecoder', class {})
    expect(preferredDevicePreviewMode()).toBe('native-h264')
  })

  it('falls back to PNG when WebCodecs is unavailable', () => {
    vi.stubGlobal('VideoDecoder', undefined)
    expect(preferredDevicePreviewMode()).toBe('native-framebuffer')
  })
})

/**
 * A stand-in for WebCodecs that never drains.
 *
 * Draining is what a real decoder does between frames; a burst is precisely the case
 * where it has not had the chance yet, so the queue here only ever grows. That makes
 * the depth the test controls and the drop policy the thing under test.
 */
class QueueingDecoder {
  static last: QueueingDecoder | null = null
  state = 'unconfigured'
  decodeQueueSize = 0
  readonly decoded: string[] = []

  constructor() { QueueingDecoder.last = this }
  configure(): void { this.state = 'configured' }
  decode(chunk: { type: string }): void {
    this.decodeQueueSize += 1
    this.decoded.push(chunk.type)
  }
  close(): void { this.state = 'closed' }
}

function frame(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'android:phone',
    sequence: 0,
    timestampMs: 1,
    timestampUs: 1,
    mimeType: 'video/avc',
    keyframe: false,
    codecConfig: false,
    codec: 'avc1.640028',
    codedWidth: 576,
    codedHeight: 1280,
    data: new Uint8Array([0]),
    ...overrides,
  } as never
}

describe('a preview fed faster than its decoder drains', () => {
  afterEach(() => vi.unstubAllGlobals())

  function start() {
    vi.stubGlobal('VideoDecoder', QueueingDecoder)
    vi.stubGlobal('EncodedVideoChunk', class {
      constructor(init: Record<string, unknown>) { Object.assign(this, init) }
    })
    const renderer = new DeviceFrameRenderer({} as HTMLCanvasElement, () => {}, () => {})
    renderer.push(frame({ codecConfig: true }))
    renderer.push(frame({ keyframe: true }))
    return renderer
  }

  // The regression: wireless adb delivers a WiFi stall as a clump of frames, and a
  // clump used to trip the queue guard — which drops everything until a keyframe, and
  // scrcpy's own keyframes are seconds apart. The preview froze once a minute.
  it('keeps decoding through the worst burst measured on a real phone', () => {
    const renderer = start()
    // 24 is what arrived inside 50ms while a screencap shared the wireless link.
    for (let i = 0; i < 24; i += 1) renderer.push(frame())
    expect(QueueingDecoder.last!.decoded).toHaveLength(25)
  })

  // The case the guard is actually for, and it still has to work: a decoder that has
  // stopped answering must not be fed forever.
  it('gives up on a decoder that never drains at all', () => {
    const renderer = start()
    for (let i = 0; i < 200; i += 1) renderer.push(frame())
    expect(QueueingDecoder.last!.decoded.length).toBeLessThan(100)
  })

  // …and having given up, it comes back on the next keyframe rather than staying dark.
  it('picks the picture back up at the next keyframe', () => {
    const renderer = start()
    for (let i = 0; i < 200; i += 1) renderer.push(frame())
    const stalled = QueueingDecoder.last!.decoded.length
    QueueingDecoder.last!.decodeQueueSize = 0
    renderer.push(frame({ keyframe: true }))
    expect(QueueingDecoder.last!.decoded.length).toBe(stalled + 1)
  })
})
