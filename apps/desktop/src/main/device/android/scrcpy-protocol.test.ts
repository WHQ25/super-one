import { describe, expect, it } from 'vitest'
import {
  readStreamHeader,
  ScrcpyPacketParser,
  type ScrcpyMediaPacket,
  type ScrcpySessionPacket,
} from './scrcpy-protocol'

/** The preamble exactly as this repo's AVD sent it: dummy, 64-byte name, codec. */
function streamHeader(name = 'sdk_gphone64_arm64', codec = 'h264'): Buffer {
  const buffer = Buffer.alloc(1 + 64 + 4)
  buffer.write(name, 1, 'utf8')
  buffer.write(codec, 65, 'utf8')
  return buffer
}

function sessionPacket(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(12)
  buffer.writeUInt8(0x80, 0)
  buffer.writeUInt32BE(width, 4)
  buffer.writeUInt32BE(height, 8)
  return buffer
}

function mediaPacket(options: {
  flags: number
  payload: Buffer
  timestampUs?: number
}): Buffer {
  const header = Buffer.alloc(12)
  header.writeBigUInt64BE(BigInt(options.timestampUs ?? 0), 0)
  header.writeUInt8(header[0]! | options.flags, 0)
  header.writeUInt32BE(options.payload.length, 8)
  return Buffer.concat([header, options.payload])
}

const SPS = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x42])
const IDR = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0x88])
const DELTA = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x61, 0x9a])

describe('readStreamHeader', () => {
  it('reads the preamble a real device sent', () => {
    expect(readStreamHeader(streamHeader())).toEqual({
      deviceName: 'sdk_gphone64_arm64',
      codec: 'h264',
      consumed: 69,
    })
  })

  it('waits rather than guessing when the preamble is still arriving', () => {
    expect(readStreamHeader(streamHeader().subarray(0, 40))).toBeNull()
  })

  it('reads a socket that carries no dummy byte', () => {
    // The dummy byte belongs to the CONNECTION, not the video — it arrives once, on
    // whichever socket connects first.
    const buffer = streamHeader().subarray(1)
    expect(readStreamHeader(buffer, { dummyByte: false })?.deviceName).toBe('sdk_gphone64_arm64')
  })

  it('stops the name at its NUL padding rather than carrying 46 zero bytes', () => {
    expect(readStreamHeader(streamHeader('Pixel 8'))?.deviceName).toBe('Pixel 8')
  })
})

describe('ScrcpyPacketParser', () => {
  it('reads the opening session packet a real stream begins with', () => {
    const [packet] = new ScrcpyPacketParser().push(sessionPacket(360, 800))
    expect(packet).toEqual({ kind: 'session', width: 360, height: 800 })
  })

  it('does not read a session packet\'s height as a payload length', () => {
    // The trap this parser exists to avoid. Bytes 8-11 are the HEIGHT on a session
    // packet and the payload SIZE on a media packet. Reading 800 as a length skips 812
    // bytes into the middle of the next frame and desynchronizes the stream for good —
    // observed while probing, and it looks like a decoder bug rather than a parse bug.
    const parser = new ScrcpyPacketParser()
    const packets = parser.push(Buffer.concat([
      sessionPacket(360, 800),
      mediaPacket({ flags: 0x40, payload: SPS }),
    ]))
    expect(packets).toHaveLength(2)
    expect(packets[1]).toMatchObject({ kind: 'media', config: true })
    expect(parser.buffered).toBe(0)
  })

  it('treats bit 7 as the session marker, not the media marker', () => {
    // `doc/develop.md` calls bit 7 the "media packet flag", which is backwards.
    // Measured: session 0x80, config 0x40, keyframe 0x20, delta 0x00. Following the
    // documentation makes every frame a session reset.
    const packets = new ScrcpyPacketParser().push(Buffer.concat([
      mediaPacket({ flags: 0x40, payload: SPS }),
      mediaPacket({ flags: 0x20, payload: IDR }),
      mediaPacket({ flags: 0x00, payload: DELTA }),
    ]))
    expect(packets.map((packet) => packet.kind)).toEqual(['media', 'media', 'media'])
    expect(packets.map((packet) => (packet as ScrcpyMediaPacket).config)).toEqual([true, false, false])
    expect(packets.map((packet) => (packet as ScrcpyMediaPacket).keyframe)).toEqual([false, true, false])
  })

  it('reports the rotation that arrives mid-stream, with the axes swapped', () => {
    // Confirmed against a real rotation: 360x800 becomes 800x360 in a session packet
    // injected between frames. This is the fact that forces the Android preview to
    // resize its canvas where the iOS one rotates a fixed-shape framebuffer.
    const parser = new ScrcpyPacketParser()
    parser.push(Buffer.concat([sessionPacket(360, 800), mediaPacket({ flags: 0x20, payload: IDR })]))
    const packets = parser.push(Buffer.concat([
      sessionPacket(800, 360),
      mediaPacket({ flags: 0x00, payload: DELTA }),
    ]))
    expect(packets[0]).toEqual({ kind: 'session', width: 800, height: 360 })
  })

  it('carries the payload through byte for byte', () => {
    const [packet] = new ScrcpyPacketParser().push(mediaPacket({ flags: 0x20, payload: IDR }))
    expect([...(packet as ScrcpyMediaPacket).data]).toEqual([...IDR])
  })
})

describe('a stream arriving in pieces', () => {
  it('holds a header split down the middle', () => {
    const parser = new ScrcpyPacketParser()
    const whole = mediaPacket({ flags: 0x20, payload: IDR })
    expect(parser.push(whole.subarray(0, 5))).toEqual([])
    expect(parser.push(whole.subarray(5))).toHaveLength(1)
  })

  it('holds a keyframe that spans a dozen reads', () => {
    // A real keyframe measured 24KB against this AVD, which never arrives in one read.
    const payload = Buffer.alloc(24_000, 0xab)
    const whole = mediaPacket({ flags: 0x20, payload })
    const parser = new ScrcpyPacketParser()
    let delivered = 0
    for (let offset = 0; offset < whole.length; offset += 1400) {
      delivered += parser.push(whole.subarray(offset, offset + 1400)).length
    }
    expect(delivered).toBe(1)
    expect(parser.buffered).toBe(0)
  })

  it('delivers everything a single oversized read completed', () => {
    const packets = new ScrcpyPacketParser().push(Buffer.concat([
      mediaPacket({ flags: 0x40, payload: SPS }),
      mediaPacket({ flags: 0x20, payload: IDR }),
      mediaPacket({ flags: 0x00, payload: DELTA }),
      mediaPacket({ flags: 0x00, payload: DELTA }),
    ]))
    expect(packets).toHaveLength(4)
  })

  it('keeps only the incomplete tail buffered', () => {
    const parser = new ScrcpyPacketParser()
    const complete = mediaPacket({ flags: 0x20, payload: IDR })
    const partial = mediaPacket({ flags: 0x00, payload: DELTA }).subarray(0, 8)
    parser.push(Buffer.concat([complete, partial]))
    expect(parser.buffered).toBe(partial.length)
  })

  it('does not hand out a view into a buffer it is about to slice away', () => {
    // The payload must be copied. A view would still point into the pending buffer
    // after the parser re-slices it, which corrupts a frame that has already been
    // handed to the decoder — intermittently, and only under fragmentation.
    const parser = new ScrcpyPacketParser()
    const whole = mediaPacket({ flags: 0x20, payload: IDR })
    const [packet] = parser.push(Buffer.concat([whole, Buffer.alloc(6, 0xff)]))
    const captured = [...(packet as ScrcpyMediaPacket).data]
    parser.push(Buffer.alloc(4096, 0x00))
    expect([...(packet as ScrcpyMediaPacket).data]).toEqual(captured)
  })
})

describe('presentation timestamps', () => {
  it('reads the 61 bits that are left after the flags', () => {
    const timestampUs = 1_234_567_890
    const [packet] = new ScrcpyPacketParser().push(
      mediaPacket({ flags: 0x20, payload: DELTA, timestampUs }),
    )
    expect((packet as ScrcpyMediaPacket).timestampUs).toBe(timestampUs)
  })

  it('does not let the flag bits leak into the timestamp', () => {
    const [packet] = new ScrcpyPacketParser().push(
      mediaPacket({ flags: 0x60, payload: DELTA, timestampUs: 42 }),
    )
    expect((packet as ScrcpyMediaPacket).timestampUs).toBe(42)
  })
})

describe('reset', () => {
  it('drops a half-received packet, so a reconnect does not resume mid-frame', () => {
    const parser = new ScrcpyPacketParser()
    parser.push(mediaPacket({ flags: 0x20, payload: IDR }).subarray(0, 8))
    parser.reset()
    expect(parser.buffered).toBe(0)
    const [packet] = parser.push(sessionPacket(1080, 2400))
    expect((packet as ScrcpySessionPacket).width).toBe(1080)
  })
})
