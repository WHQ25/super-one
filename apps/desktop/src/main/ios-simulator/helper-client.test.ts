import { describe, expect, it } from 'vitest'
import {
  IosSimulatorHelperRuntime,
  isCoalescibleTouchUpdate,
  NativeFrameParser,
} from './helper-client'

function record(
  payload: Buffer,
  options: { kind?: number; keyframe?: boolean; timestampUs?: bigint } = {},
): Buffer {
  const headerBytes = 12
  const value = Buffer.alloc(4 + headerBytes + payload.length)
  value.writeUInt32LE(headerBytes + payload.length, 0)
  value[4] = options.kind ?? 1
  value[5] = options.keyframe ? 1 : 0
  value.writeBigUInt64LE(options.timestampUs ?? 123_000n, 8)
  payload.copy(value, 4 + headerBytes)
  return value
}

describe('NativeFrameParser', () => {
  it('reassembles fragmented records and returns multiple frames', () => {
    const parser = new NativeFrameParser()
    const wire = Buffer.concat([record(Buffer.from('first')), record(Buffer.from('second'))])

    expect(parser.push(wire.subarray(0, 3))).toEqual([])
    expect(parser.push(wire.subarray(3, 23)).map((frame) => frame.data.toString())).toEqual(['first'])
    expect(parser.push(wire.subarray(23)).map((frame) => frame.data.toString())).toEqual(['second'])
  })

  it('parses H.264 metadata without copying it into the payload', () => {
    const parser = new NativeFrameParser()
    const [frame] = parser.push(record(
      Buffer.from([0, 0, 0, 1, 0x65]),
      { kind: 3, keyframe: true, timestampUs: 456_000n },
    ))

    expect(frame).toEqual(expect.objectContaining({
      kind: 'h264', keyframe: true, timestampUs: 456_000,
    }))
    expect(frame.data).toEqual(Buffer.from([0, 0, 0, 1, 0x65]))
  })

  it('reassembles a record split across many chunks and keeps the tail of the last', () => {
    const parser = new NativeFrameParser()
    const payload = Buffer.alloc(5000, 0xab)
    const wire = Buffer.concat([record(payload, { kind: 3 }), record(Buffer.from('after'))])

    // Byte at a time through the length prefix, then 512-byte reads — the shape a
    // real socket produces, and the case the chunk list has to get right.
    const frames = []
    for (let at = 0; at < wire.length; at += at < 6 ? 1 : 512) {
      frames.push(...parser.push(wire.subarray(at, Math.min(at + (at < 6 ? 1 : 512), wire.length))))
    }

    expect(frames).toHaveLength(2)
    expect(frames[0]!.data.equals(payload)).toBe(true)
    expect(frames[1]!.data.toString()).toBe('after')
  })

  it('gives each record its own exact buffer, so a view over it can cross IPC', () => {
    const parser = new NativeFrameParser()
    const [frame] = parser.push(record(Buffer.from('tiny')))

    // Small records must not come off Buffer's shared pool: `emitFrame` sends a view
    // over this record, and structured clone copies a view's whole backing store —
    // a pooled record would ship the entire slab, other frames' bytes included.
    expect(frame!.data.buffer.byteLength).toBe(4 + 12 + 'tiny'.length)
  })

  it('rejects an unreasonable frame length before allocating it', () => {
    const parser = new NativeFrameParser()
    const header = Buffer.alloc(4)
    header.writeUInt32LE(33 * 1024 * 1024)

    expect(() => parser.push(header)).toThrow(/too large/i)
  })
})

describe('isCoalescibleTouchUpdate', () => {
  it('coalesces only non-empty move-only contact snapshots', () => {
    expect(isCoalescibleTouchUpdate({
      type: 'touch.update',
      contacts: [
        { id: 1, phase: 'moved', xRatio: 0.2, yRatio: 0.3 },
        { id: 2, phase: 'moved', xRatio: 0.8, yRatio: 0.7 },
      ],
    })).toBe(true)
    expect(isCoalescibleTouchUpdate({
      type: 'touch.update',
      contacts: [{ id: 2, phase: 'ended', xRatio: 0.8, yRatio: 0.7 }],
    })).toBe(false)
    expect(isCoalescibleTouchUpdate({ type: 'touch.update', contacts: [] })).toBe(false)
  })
})

describe('IosSimulatorHelperRuntime lifetime', () => {
  // A binary that exits the moment it is spawned, which is what a helper looks like
  // when Xcode moved out from under it. Writing to its stdin raises EPIPE on the
  // stream rather than on the child, so an unhandled one takes main down with it.
  const DEAD_HELPER = '/usr/bin/false'

  it('reports the exit instead of answering from a helper that is gone', async () => {
    const runtime = new IosSimulatorHelperRuntime(DEAD_HELPER)

    const first = await runtime.input({ type: 'paste' })

    expect(first.ok).toBe(false)
    expect(runtime.alive).toBe(false)
  })

  it('refuses to respawn silently once the process has exited', async () => {
    const runtime = new IosSimulatorHelperRuntime(DEAD_HELPER)
    await runtime.input({ type: 'paste' })

    // A lazily restarted child would take input for a device nobody attached it to,
    // so the owner has to rebuild the runtime — which is what `alive` is read for.
    const second = await runtime.input({ type: 'paste' })

    expect(second).toEqual({ ok: false, error: 'iOS helper runtime exited.' })
  })
})
