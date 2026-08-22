/**
 * scrcpy's video packets, in the shape the panel's decoder expects.
 *
 * The two streams the renderer decodes through one path do NOT arrive the same way,
 * and this is where the difference is absorbed. The simulator's helper prepends the
 * parameter sets to every keyframe and uses its config packet purely to announce the
 * codec string; scrcpy sends the parameter sets ONCE, as the payload of its config
 * packet, and never again.
 *
 * Left alone that is a preview that spins forever: the renderer configures a decoder
 * off the config packet and drops its payload, and no keyframe after it carries an
 * SPS, so the decoder is handed pictures it has no dimensions for and emits nothing.
 * Nothing errors — there is simply never a first frame.
 *
 * So the parameter sets are held here and stamped onto each keyframe, which also
 * makes every keyframe a real random-access point: a decoder rebuilt mid-stream (a
 * quality change, a panel remount) recovers on the next one instead of waiting for a
 * config packet that already went past.
 */

import type { DeviceFrame } from '@superone/shared/device'
import type { ScrcpyMediaPacket } from './scrcpy-protocol'
import { h264CodecString } from './h264'

/**
 * Only ever used if a device's first config packet holds no readable SPS. High 4.0 is
 * the safest guess for a stream we could not read, and a wrong guess here fails
 * loudly at `configure` rather than silently.
 */
const FALLBACK_CODEC = 'avc1.640028'

export interface AndroidFrameContext {
  deviceId: string
  screen: { width: number; height: number }
  timestampMs?: number
}

export class AndroidVideoStream {
  private parameterSets: Buffer | null = null
  private codec = FALLBACK_CODEC
  private sequence = 0

  frame(packet: ScrcpyMediaPacket, context: AndroidFrameContext): DeviceFrame {
    if (packet.config) {
      this.parameterSets = packet.data
      this.codec = h264CodecString(packet.data) ?? FALLBACK_CODEC
    }
    // A keyframe on its own is not decodable, so it goes out with the parameter sets
    // in front of it. Config packets pass through unchanged: the renderer reads the
    // codec off them and ignores their bytes, exactly as it does for the simulator.
    const data = packet.keyframe && !packet.config && this.parameterSets
      ? Buffer.concat([this.parameterSets, packet.data])
      : packet.data
    return {
      deviceId: context.deviceId,
      sequence: this.sequence++,
      timestampMs: context.timestampMs ?? Date.now(),
      timestampUs: packet.timestampUs,
      mimeType: 'video/avc',
      keyframe: packet.keyframe,
      codecConfig: packet.config,
      codec: this.codec,
      codedWidth: context.screen.width,
      codedHeight: context.screen.height,
      data,
    }
  }
}
