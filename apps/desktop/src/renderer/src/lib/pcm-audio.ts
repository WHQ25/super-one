/** 16-bit little-endian PCM helpers for the Doubao voice shell. */

export function floatToS16le(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0))
    view.setInt16(i * 2, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true)
  }
  return out
}

export function s16leToFloat(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const count = Math.floor(pcm.byteLength / 2)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

export function pcmRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let energy = 0
  for (const value of samples) energy += value * value
  return Math.sqrt(energy / samples.length)
}
