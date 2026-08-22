/**
 * The one thing a WebCodecs decoder needs that an H.264 stream only states about
 * itself: which profile and level it was encoded at.
 *
 * `VideoDecoder.configure` takes that as an `avc1.PPCCLL` string, and getting it
 * wrong is not cosmetic — Chromium checks the string against the bitstream and
 * refuses a configuration that does not match. The encoder on the guest picks the
 * profile, not us: this emulator hands out Baseline 4.1 (`avc1.42c029`), a physical
 * device may well hand out High. So it is read off the stream's own SPS rather than
 * being written down anywhere.
 */

/** Where a NAL unit starts, and how long its start code was. */
function* nalUnits(annexB: Uint8Array): Generator<{ start: number; type: number }> {
  for (let index = 0; index + 3 < annexB.length; index += 1) {
    if (annexB[index] !== 0 || annexB[index + 1] !== 0) continue
    let payload: number
    if (annexB[index + 2] === 1) payload = index + 3
    else if (annexB[index + 2] === 0 && annexB[index + 3] === 1) payload = index + 4
    else continue
    if (payload >= annexB.length) return
    yield { start: payload, type: annexB[payload]! & 0x1f }
    index = payload
  }
}

const SPS_NAL_TYPE = 7

/**
 * `avc1.PPCCLL` for this stream, or null when the bytes carry no SPS.
 *
 * The three bytes after the SPS header ARE the string, in order: profile_idc, the
 * constraint-flag byte, level_idc. No parsing of the exp-Golomb body below them is
 * needed, which is what keeps this a dozen lines instead of a bitstream reader.
 */
export function h264CodecString(annexB: Uint8Array): string | null {
  for (const nal of nalUnits(annexB)) {
    if (nal.type !== SPS_NAL_TYPE) continue
    if (nal.start + 3 >= annexB.length) return null
    const hex = [annexB[nal.start + 1]!, annexB[nal.start + 2]!, annexB[nal.start + 3]!]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return `avc1.${hex}`
  }
  return null
}
