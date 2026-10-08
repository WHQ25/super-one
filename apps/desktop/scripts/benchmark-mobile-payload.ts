/** Run: bun apps/desktop/scripts/benchmark-mobile-payload.ts (synthetic fixtures, no services). */
import { deriveKeys, encryptPayload } from '../src/main/remote-control-crypto'
import { frameHostPayload } from '../src/main/remote/payload-codec'
import { decodeHostPlaintext } from '@superone/relay-client/host-payload'
import { openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { acceptClientHello, issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'
import { RemoteEventBatcher } from '../src/main/remote/event-batcher'
import type { AgentEvent } from '@superone/shared/agent-types'

const secret = '0123456789abcdef'.repeat(8)
const host = await deriveKeys(secret)
// One phone link channel, as a paired phone would hold after its handshake.
const credential = issueChannelCredential(secret.slice(0, 64), 'benchmark-phone')
const hello = startClientHandshake(credential)
const accept = acceptClientHello(hello.hello, () => credential.secretHex)
const { proof, channel: phone } = hello.finish(accept.challenge)
const hostChannel = accept.finish(proof)
const seal = async (payload: unknown) => sealLinkFrame(hostChannel, { t: 'event' }, await frameHostPayload(payload))
const envelopeBytes = (data: string, type = 'response') => Buffer.byteLength(JSON.stringify({ type, requestId: 'fixture', data }))
let seed = 42
const binary = Uint8Array.from({ length: 256 * 1024 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24 })
const fixtures = {
  small: { ok: true },
  catalog: { models: Array.from({ length: 60 }, (_,i) => ({ id: `provider/model-${i}`, name: `Model ${i}`, contextWindow: 200000, supportedEffortLevels: ['low', 'medium', 'high'] })) },
  transcript: { messages: Array.from({ length: 200 }, (_, i) => ({ id: `message-${i}`, role: i % 2 ? 'assistant' : 'user', status: 'complete', content: [{ type: 'text', text: `Message ${i}: inspect the files, verify behavior, and report the result.\n`.repeat(20) }] })) },
  binaryBase64: { base64: Buffer.from(binary).toString('base64') },
}
const rows = []
for (const [name, fixture] of Object.entries(fixtures)) {
  const old = await encryptPayload(host.aesKey, fixture)
  const timings = []
  let wire = ''
  for (let i = 0; i < 6; i++) {
    const start = performance.now()
    wire = await seal(fixture)
    const encodedAt = performance.now()
    const decoded = decodeHostPlaintext(openLinkFrame(phone, wire).payload)
    if (JSON.stringify(decoded) !== JSON.stringify(fixture)) throw new Error(`Roundtrip failed: ${name}`)
    if (i > 0) timings.push({ encodeMs: encodedAt - start, decodeMs: performance.now() - encodedAt })
  }
  const median = (key: 'encodeMs' | 'decodeMs') => Number(timings.map(t=>t[key]).sort((a,b)=>a-b)[2]!.toFixed(3))
  rows.push({ name, jsonBytes: Buffer.byteLength(JSON.stringify(fixture)), oldEnvelopeBytes: envelopeBytes(old), newEnvelopeBytes: envelopeBytes(wire), encodeMs: median('encodeMs'), decodeMs: median('decodeMs') })
}
const events = Array.from({ length: 200 }, (_, i) => ({ type: 'content_delta', messageId: 'assistant', seq: i + 1, delta: { type: 'text', text: `word${i} ` } } as AgentEvent))
const batches: AgentEvent[][] = []
const batcher = new RemoteEventBatcher(events => batches.push(events))
// Model a 500 events/s source: up to 16 events inside one 33 ms window.
for (let i = 0; i < events.length; i++) { batcher.push(events[i]!, ['phone']); if (i % 16 === 15) batcher.flush() }
batcher.flush(); batcher.dispose()
let oldBytes = 0, newBytes = 0
for (const event of events) oldBytes += envelopeBytes(await encryptPayload(host.aesKey, [event]), 'event')
for (const batch of batches) newBytes += envelopeBytes(await seal(batch), 'event')
console.log(JSON.stringify({ runtime: process.version, synthetic: true, rows, stream: { events: events.length, oldFrames: events.length, newFrames: batches.length, oldBytes, newBytes } }, null, 2))
