// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installSuperoneMediaProbe, type MiniAppTransport } from './miniapp-api-runtime'

class MockTrack {
  kind: 'audio' | 'video'
  private listeners = new Map<string, Array<() => void>>()
  stopCount = 0

  constructor(kind: 'audio' | 'video') {
    this.kind = kind
  }

  addEventListener(type: string, cb: () => void) {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }

  removeEventListener(type: string, cb: () => void) {
    const arr = this.listeners.get(type)
    if (arr) this.listeners.set(type, arr.filter((x) => x !== cb))
  }

  stop() {
    this.stopCount++
  }

  fireEnded() {
    const arr = this.listeners.get('ended') ?? []
    for (const cb of [...arr]) cb()
  }
}

class MockStream {
  constructor(public tracks: MockTrack[]) {}
  getTracks() { return this.tracks }
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, writable: true, value })
}

describe('installSuperoneMediaProbe', () => {
  let realGUM: ReturnType<typeof vi.fn>
  let transport: MiniAppTransport & { send: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    realGUM = vi.fn()
    setMediaDevices({ getUserMedia: realGUM })
    const send = vi.fn()
    transport = {
      send: send as MiniAppTransport['send'] & typeof send,
      request: vi.fn() as unknown as MiniAppTransport['request'],
      on: vi.fn() as unknown as MiniAppTransport['on'],
    }
    delete (window as unknown as { __superoneIpcToHost?: unknown }).__superoneIpcToHost
  })

  afterEach(() => {
    setMediaDevices(undefined)
  })

  it('replaces getUserMedia with a wrapper', () => {
    const original = navigator.mediaDevices.getUserMedia
    installSuperoneMediaProbe(transport)
    expect(navigator.mediaDevices.getUserMedia).not.toBe(original)
  })

  it('emits media-started with microphone kind for an audio stream', async () => {
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true })

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-started', { kinds: ['microphone'] })
  })

  it('emits media-started with camera kind for a video stream', async () => {
    const track = new MockTrack('video')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ video: true })

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-started', { kinds: ['camera'] })
  })

  it('emits both kinds for a combined audio+video stream', async () => {
    const audio = new MockTrack('audio')
    const video = new MockTrack('video')
    realGUM.mockResolvedValue(new MockStream([audio, video]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true, video: true })

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-started', { kinds: ['microphone', 'camera'] })
  })

  it('emits track-ended when the track fires the natural ended event', async () => {
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true })
    track.fireEnded()

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-track-ended', { kind: 'microphone' })
  })

  it('emits track-ended when the patched track.stop() is called', async () => {
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks()[0].stop()

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-track-ended', { kind: 'microphone' })
    expect(track.stopCount).toBe(1)
  })

  it('emits track-ended exactly once even if stop() then ended event both fire', async () => {
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks()[0].stop()
    track.fireEnded()

    const endedCalls = transport.send.mock.calls.filter((c) => c[0] === 'miniapp-media-track-ended')
    expect(endedCalls).toHaveLength(1)
  })

  it('emits track-ended exactly once when ended fires twice', async () => {
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true })
    track.fireEnded()
    track.fireEnded()

    const endedCalls = transport.send.mock.calls.filter((c) => c[0] === 'miniapp-media-track-ended')
    expect(endedCalls).toHaveLength(1)
  })

  it('uses window.__superoneIpcToHost when present (webview path)', async () => {
    const ipc = vi.fn()
    ;(window as unknown as { __superoneIpcToHost: typeof ipc }).__superoneIpcToHost = ipc
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true })

    expect(ipc).toHaveBeenCalledWith('miniapp-media-started', { kinds: ['microphone'] })
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('falls back to transport.send when __superoneIpcToHost throws', async () => {
    ;(window as unknown as { __superoneIpcToHost: () => void }).__superoneIpcToHost = () => {
      throw new Error('ipc broken')
    }
    const track = new MockTrack('audio')
    realGUM.mockResolvedValue(new MockStream([track]))
    installSuperoneMediaProbe(transport)

    await navigator.mediaDevices.getUserMedia({ audio: true })

    expect(transport.send).toHaveBeenCalledWith('miniapp-media-started', { kinds: ['microphone'] })
  })

  it('propagates errors from the underlying getUserMedia call', async () => {
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    realGUM.mockRejectedValue(err)
    installSuperoneMediaProbe(transport)

    await expect(navigator.mediaDevices.getUserMedia({ audio: true })).rejects.toThrow('Permission denied')
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('is a no-op when navigator.mediaDevices is undefined', () => {
    setMediaDevices(undefined)
    expect(() => installSuperoneMediaProbe(transport)).not.toThrow()
  })

  it('is a no-op when mediaDevices has no getUserMedia', () => {
    setMediaDevices({})
    expect(() => installSuperoneMediaProbe(transport)).not.toThrow()
  })
})
