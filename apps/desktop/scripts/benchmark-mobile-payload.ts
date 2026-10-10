/** Run: bun apps/desktop/scripts/benchmark-mobile-payload.ts (native codec timings; the immutable budget gate uses the real endpoint). */
import { WireEncoder, WireDecoder } from '@superone/shared/environment/wire'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { acceptClientHello, issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'

const credential = issueChannelCredential('0123456789abcdef'.repeat(4), 'benchmark-phone')
const hello = startClientHandshake(credential)
const accept = acceptClientHello(hello.hello, () => credential.secretHex)
const { proof, channel: phone } = hello.finish(accept.challenge)
const host = accept.finish(proof)
const encoder = new WireEncoder(nodeWireCompression)
const decoder = new WireDecoder(nodeWireCompression)
let seed = 42
const binary = Uint8Array.from({ length: 256 * 1024 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24 })
const fixtures = {
  small: { ok: true },
  catalog: { models: Array.from({ length: 60 }, (_, i) => ({ id: `provider/model-${i}`, name: `Model ${i}`, contextWindow: 200000, supportedEffortLevels: ['low', 'medium', 'high'] })) },
  transcript: { messages: Array.from({ length: 200 }, (_, i) => ({ id: `message-${i}`, role: i % 2 ? 'assistant' : 'user', status: 'complete', content: [{ type: 'text', text: `Message ${i}: inspect the files, verify behavior, and report the result.\n`.repeat(20) }] })) },
  binaryBase64: { base64: Buffer.from(binary).toString('base64') },
}
const rows = []
for (const [name, result] of Object.entries(fixtures)) {
  const message = { type: 'rpc_result', requestId: 'r1', result }
  const timings: Array<{ encodeMs: number; decodeMs: number }> = []
  let frames = 0
  let bytes = 0
  for (let run = 0; run < 6; run++) {
    const start = performance.now()
    const sealed = encoder.encode(message).map(frame => JSON.stringify({ type: 'terminal', targets: ['benchmark-phone'], data: sealLinkFrame(host, { t: 'rpc' }, frame) }))
    const encodedAt = performance.now()
    let decoded: unknown
    for (const text of sealed) {
      const frame = openLinkFrame(phone, JSON.parse(text).data)
      decoded = decoder.decode(frame.payload) ?? decoded
    }
    if (JSON.stringify(decoded) !== JSON.stringify(message)) throw new Error(`Roundtrip failed: ${name}`)
    frames = sealed.length
    bytes = sealed.reduce((sum, text) => sum + Buffer.byteLength(text), 0)
    if (run > 0) timings.push({ encodeMs: encodedAt - start, decodeMs: performance.now() - encodedAt })
  }
  const mean = (key: keyof typeof timings[number]) => Number((timings.reduce((sum, timing) => sum + timing[key], 0) / timings.length).toFixed(2))
  rows.push({ fixture: name, jsonBytes: Buffer.byteLength(JSON.stringify(message)), frames, wireBytes: bytes, encodeMs: mean('encodeMs'), decodeMs: mean('decodeMs') })
}
console.table(rows)
