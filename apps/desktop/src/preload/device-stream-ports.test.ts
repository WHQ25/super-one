import { describe, expect, it, vi } from 'vitest'
import type { DeviceFrame } from '@superone/shared/device'
import { DeviceStreamPorts, type DeviceFramePort } from './device-stream-ports'

function port(): DeviceFramePort & { started: boolean; closed: boolean; emitClose: () => void } {
  const listeners = new Set<() => void>()
  return {
    onmessage: null,
    started: false,
    closed: false,
    start() { this.started = true },
    close() { this.closed = true },
    addEventListener(_type, listener) { listeners.add(listener) },
    removeEventListener(_type, listener) { listeners.delete(listener) },
    emitClose() {
      for (const listener of [...listeners]) listener()
    },
  }
}

function harness() {
  const sendOpen = vi.fn()
  const sendClose = vi.fn()
  const listeners = new Map<string, Set<(frame: DeviceFrame) => void>>()
  const timers = new Map<number, () => void>()
  let nextId = 1
  const ports = new DeviceStreamPorts(
    sendOpen,
    sendClose,
    listeners,
    (fn) => {
      const id = nextId++
      timers.set(id, fn)
      return id as unknown as ReturnType<typeof setTimeout>
    },
    (timer) => { timers.delete(timer as unknown as number) },
  )
  return {
    ports,
    sendOpen,
    sendClose,
    listeners,
    flush() {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) fn()
    },
  }
}

const QUALITY = { mode: 'native-h264', quality: { scale: 1, maxFrameRate: 0 } }

describe('device preview port', () => {
  it('asks for the stream again when its port closes', () => {
    const { ports, sendOpen, flush } = harness()
    ports.open('ios-sim:duo', QUALITY)
    const current = port()
    ports.accept('ios-sim:duo', current)

    current.emitClose()
    expect(sendOpen).toHaveBeenCalledTimes(1)
    flush()

    expect(sendOpen).toHaveBeenCalledTimes(2)
    expect(sendOpen).toHaveBeenLastCalledWith('ios-sim:duo', QUALITY)
  })

  it('does not ask again after the panel closes the stream', () => {
    const { ports, sendOpen, sendClose, flush } = harness()
    ports.open('ios-sim:duo', QUALITY)
    const current = port()
    ports.accept('ios-sim:duo', current)

    ports.close('ios-sim:duo')
    flush()

    expect(current.closed).toBe(true)
    expect(sendClose).toHaveBeenCalledWith('ios-sim:duo')
    expect(sendOpen).toHaveBeenCalledTimes(1)
  })

  it('ignores the port it just replaced', () => {
    const { ports, sendOpen, flush } = harness()
    ports.open('ios-sim:duo', QUALITY)
    const first = port()
    ports.accept('ios-sim:duo', first)
    const second = port()
    ports.accept('ios-sim:duo', second)

    first.emitClose()
    flush()

    expect(first.closed).toBe(true)
    expect(second.started).toBe(true)
    expect(sendOpen).toHaveBeenCalledTimes(1)
  })

  it('stops asking after repeated closes and resumes once a frame arrives', () => {
    const { ports, sendOpen, listeners, flush } = harness()
    const seen: DeviceFrame[] = []
    listeners.set('ios-sim:duo', new Set([(frame) => seen.push(frame)]))
    ports.open('ios-sim:duo', QUALITY)
    let current = port()
    ports.accept('ios-sim:duo', current)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      current.emitClose()
      flush()
      current = port()
      ports.accept('ios-sim:duo', current)
    }
    expect(sendOpen).toHaveBeenCalledTimes(4)

    const frame = { mimeType: 'video/avc' } as DeviceFrame
    current.onmessage?.({ data: frame })
    expect(seen).toEqual([frame])
    current.emitClose()
    flush()
    expect(sendOpen).toHaveBeenCalledTimes(5)
  })

  it('stops asking when the port keeps closing before a frame arrives', () => {
    const { ports, sendOpen, flush } = harness()
    ports.open('ios-sim:duo', QUALITY)
    let current = port()
    ports.accept('ios-sim:duo', current)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      current.emitClose()
      flush()
      current = port()
      ports.accept('ios-sim:duo', current)
    }
    current.emitClose()
    flush()

    expect(sendOpen).toHaveBeenCalledTimes(4)
  })
})
