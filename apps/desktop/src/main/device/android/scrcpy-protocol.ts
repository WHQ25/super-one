/**
 * The scrcpy 4.0 video stream, as it actually arrives.
 *
 * Every offset and flag below was read off a real socket against this repo's AVD, not
 * transcribed from prose — and one of them contradicts the prose. See `SESSION_FLAG`.
 *
 * Layout of the video socket, in order:
 *
 *   [0]        dummy byte, sent once on the FIRST socket opened
 *   [1, 65)    device name, 64 bytes, NUL-padded ("sdk_gphone64_arm64")
 *   [65, 69)   codec id, u32 ("h264")
 *   then a stream of 12-byte headers, each either a session or a media packet
 *
 * The dummy byte and device name belong to the connection, not to the video: they
 * arrive on whichever socket connects first, which is why `readStreamHeader` takes
 * them together with the codec rather than as a separate step.
 */

/** Pinned to the jar in `resources/scrcpy`. Client and server versions must match exactly. */
export const SCRCPY_SERVER_VERSION = '4.0'

/** Of `resources/scrcpy/scrcpy-server-v4.0.jar`, verified before it is pushed. */
export const SCRCPY_SERVER_SHA256 =
  '84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a'

/** Where the jar is pushed. Not persistent — see `ScrcpySession`. */
export const SCRCPY_DEVICE_PATH = '/data/local/tmp/scrcpy-server.jar'

const DEVICE_NAME_BYTES = 64
const CODEC_ID_BYTES = 4
export const SCRCPY_HEADER_BYTES = 12

/**
 * Bit 7 marks a SESSION packet, not a media packet.
 *
 * `doc/develop.md` calls bit 7 the "media packet flag", which is backwards. Measured
 * against a running device: session packets arrive as 0x80, config packets as 0x40,
 * keyframes as 0x20 and delta frames as 0x00 — media packets never set bit 7.
 * Implementing it the documented way treats every single frame as a session reset.
 */
const SESSION_FLAG = 0x80
const CONFIG_FLAG = 0x40
const KEYFRAME_FLAG = 0x20

/**
 * A capture session's geometry.
 *
 * Re-sent mid-stream whenever the device rotates, with width and height SWAPPED —
 * 360x800 becomes 800x360, confirmed on a real rotation. This is the fact that
 * separates Android from iOS at the rendering layer: a simulator draws its rotated UI
 * into a framebuffer that never changes shape, so the host can turn the whole device
 * as one rigid object. Here the framebuffer itself is re-shaped, and whatever draws
 * it has to resize instead of rotate.
 */
export interface ScrcpySessionPacket {
  kind: 'session'
  width: number
  height: number
}

export interface ScrcpyMediaPacket {
  kind: 'media'
  /** SPS/PPS rather than a picture. What a decoder needs before its first frame. */
  config: boolean
  keyframe: boolean
  /** Presentation timestamp in microseconds. */
  timestampUs: number
  /** Annex-B, with 4-byte start codes. */
  data: Buffer
}

export type ScrcpyPacket = ScrcpySessionPacket | ScrcpyMediaPacket

export interface ScrcpyStreamHeader {
  deviceName: string
  codec: string
  /** How many bytes of the buffer the header consumed. */
  consumed: number
}

/**
 * Read the once-per-connection preamble.
 *
 * Null when the buffer does not hold all of it yet — the caller keeps accumulating.
 */
export function readStreamHeader(
  buffer: Buffer,
  options: { dummyByte?: boolean } = {},
): ScrcpyStreamHeader | null {
  const dummy = options.dummyByte === false ? 0 : 1
  const total = dummy + DEVICE_NAME_BYTES + CODEC_ID_BYTES
  if (buffer.length < total) return null
  const nameBytes = buffer.subarray(dummy, dummy + DEVICE_NAME_BYTES)
  const end = nameBytes.indexOf(0)
  return {
    deviceName: nameBytes.subarray(0, end < 0 ? DEVICE_NAME_BYTES : end).toString('utf8'),
    codec: buffer.subarray(dummy + DEVICE_NAME_BYTES, total).toString('utf8'),
    consumed: total,
  }
}

/**
 * Reassembles packets out of whatever the socket hands over.
 *
 * Stateful because a 24KB keyframe arrives across a dozen reads and a header can be
 * split down the middle. Holding the remainder here rather than re-concatenating the
 * whole stream is what keeps a long session from turning into quadratic copying.
 */
export class ScrcpyPacketParser {
  /**
   * Bytes held back for the packet they belong to.
   *
   * Typed against `ArrayBufferLike` because it is advanced with `subarray`, which
   * yields a view rather than a copy. That is the point — re-concatenating the whole
   * remainder on every read would make a long session quadratic — and the wider type
   * is what a view honestly is.
   */
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  /** Feed bytes, get back whatever complete packets they completed. */
  push(chunk: Buffer): ScrcpyPacket[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const packets: ScrcpyPacket[] = []
    let offset = 0

    while (this.pending.length - offset >= SCRCPY_HEADER_BYTES) {
      const flags = this.pending[offset]!
      if ((flags & SESSION_FLAG) !== 0) {
        packets.push({
          kind: 'session',
          width: this.pending.readUInt32BE(offset + 4),
          height: this.pending.readUInt32BE(offset + 8),
        })
        offset += SCRCPY_HEADER_BYTES
        continue
      }

      const size = this.pending.readUInt32BE(offset + 8)
      if (this.pending.length - offset - SCRCPY_HEADER_BYTES < size) break
      const start = offset + SCRCPY_HEADER_BYTES
      packets.push({
        kind: 'media',
        config: (flags & CONFIG_FLAG) !== 0,
        keyframe: (flags & KEYFRAME_FLAG) !== 0,
        timestampUs: readPts(this.pending, offset),
        // Copied, not a view: the pending buffer is reallocated below, and a view into
        // a buffer that is about to be sliced away is a use-after-free in slow motion.
        data: Buffer.from(this.pending.subarray(start, start + size)),
      })
      offset = start + size
    }

    this.pending = offset === 0
      ? this.pending
      : this.pending.subarray(offset)
    return packets
  }

  /** Bytes held back waiting for the rest of their packet. For diagnostics. */
  get buffered(): number {
    return this.pending.length
  }

  reset(): void {
    this.pending = Buffer.alloc(0)
  }
}

/**
 * The 61-bit presentation timestamp sharing its first byte with the flags.
 *
 * Read through BigInt because the top three bits are flags and the remaining 61 do not
 * fit a double without losing the low end — which is precisely the end that
 * distinguishes consecutive frames.
 */
function readPts(buffer: Buffer, offset: number): number {
  const raw = buffer.readBigUInt64BE(offset) & 0x1fff_ffff_ffff_ffffn
  return Number(raw)
}
