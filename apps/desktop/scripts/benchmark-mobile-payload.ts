/**
 * Run: bun apps/desktop/scripts/benchmark-mobile-payload.ts
 * Native codec timings, then legacy `session.load` pages against transcript
 * windows on the same fixtures (the immutable budget gate uses the real endpoint).
 */
import { WireEncoder, WireDecoder } from '@superone/shared/environment/wire'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { openLinkFrame, sealLinkFrame } from '@superone/relay-client/phone-link'
import { acceptClientHello, issueChannelCredential, startClientHandshake } from '@superone/relay-client/secure-channel'
import type { ChatMessage } from '@superone/shared/agent-types'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, windowCoverage, windowLookup } from '@superone/shared/transcript-window/window-store'
import { windowBudget } from '@superone/shared/transcript-window/select-window'
import { conversation, longReplyText, textMessage, toolTurn } from '@superone/shared/transcript-window/window-fixtures'
import { projectProgressiveMessage, WindowViews } from '@superone/runtime/stream'
import type { TranscriptWindowRequest, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { handleSessionTranscriptWindow } from '@superone/runtime/server/rpc-session-window'
import type { RpcContext } from '@superone/runtime/server/rpc-context'
import { ConnectionDelivery } from '@superone/runtime/stream/delivery/connection-delivery'
import { deliveryPolicy } from '@superone/runtime/stream/delivery-policy'
import { stripMessagesForRemote } from '@superone/runtime/stream/delivery/remote-content'

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

// Legacy restore sends the newest eight projected messages whole; a window sends
// a bounded fragment range and omits bodies the phone already holds.
const utf8 = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const legacyPage = (messages: ChatMessage[]) => stripMessagesForRemote(messages.slice(-8).map(projectProgressiveMessage))
const viewport = { width: 390, height: 844 }
function windowOf(messages: ChatMessage[], have?: ReturnType<typeof windowCoverage>) {
  const start = performance.now()
  const result = new WindowViews().serve({ sessionId: 's', holder: '', messages, request: { have }, budget: windowBudget({ viewport }) })
  return { result, projectionMs: performance.now() - start }
}
const cached = conversation(6)
const scenarios: Record<string, { messages: ChatMessage[]; cached?: ChatMessage[] }> = {
  'cold open, 1 MB reply': { messages: [textMessage('u', 'user', 'Explain'), textMessage('a', 'assistant', longReplyText(1024 * 1024))] },
  '6 cached + 2 new': { messages: [...cached, ...conversation(2, 'n')], cached },
  '500-tool active turn': { messages: [textMessage('u', 'user', 'Go'), toolTurn('a', 500)] },
}
const comparison = []
for (const [name, scenario] of Object.entries(scenarios)) {
  const legacy = legacyPage(scenario.messages)
  const cachedIds = new Set(scenario.cached?.map((message) => message.id))
  const held = scenario.cached && applyWindowResult(null, { ...windowOf(scenario.cached).result }, EMPTY_WINDOW_LOOKUP).state
  const { result, projectionMs } = windowOf(scenario.messages, held ? windowCoverage(held.messages) : undefined)
  const resent = result.messages.filter((message) => cachedIds.has(message.id)).flatMap((message) => message.fragments.filter((fragment) => fragment.body))
  comparison.push({
    scenario: name,
    legacyBytes: utf8(legacy),
    legacyDuplicateBytes: cachedIds.size ? utf8(legacy.filter((message) => cachedIds.has(message.id))) : 0,
    windowBytes: utf8(result),
    windowDuplicateBytes: resent.length ? utf8(resent) : 0,
    windowFragments: result.messages.reduce((sum, message) => sum + message.fragments.length, 0),
    projectionMs: Number(projectionMs.toFixed(2)),
  })
}
console.table(comparison)

// Measure the RPC response before encryption. Copy this script to another checkout
// to compare both revisions with the same request, fixtures, and codec.
const beforeCompact: ChatMessage = {
  ...textMessage('turn', 'assistant', '', 'streaming'),
  content: Array.from({ length: 4 }, (_, i) => [
    { type: 'tool_use' as const, toolName: 'Bash', toolUseId: 'b' + i, input: '{"command":"pwd"}', status: 'complete' as const },
    { type: 'tool_result' as const, toolUseId: 'b' + i, summary: 'ok' },
  ]).flat(),
}
const marker = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 100 }, 'c1', '', beforeCompact)
const compactText = longReplyText(81920)
const resumeFixtures: Record<string, ChatMessage[]> = {
  compaction: [marker, { ...beforeCompact, content: [...beforeCompact.content, { type: 'text', text: compactText }] }],
  settled: [...conversation(20), textMessage('turn', 'assistant', 'answer')],
}

const restores = []
for (const [fixture, messages] of Object.entries(resumeFixtures)) {
  const version = 1
  const ctx = {
    client: { clientSessionId: 'c', scopes: ['session:read'] },
    sessions: {
      messages: () => messages,
      load: () => ({ messages, state: { status: 'streaming' }, cursor: { sequence: String(version), epoch: 'e', version } }),
    },
    streams: { delivery: new ConnectionDelivery(deliveryPolicy('relay', 'phone')) },
  } as unknown as RpcContext
  const read = async (have?: TranscriptWindowRequest['have']) => {
    const request = { sessionId: 's', folds: true, viewport, ...(have ? { have } : {}) }
    const reply = await handleSessionTranscriptWindow(request, ctx)
    if (reply.error) throw new Error(reply.error.message)
    return { request, result: reply.result as TranscriptWindowResult }
  }
  const cold = await read()
  const cache = applyWindowResult(null, cold.result, EMPTY_WINDOW_LOOKUP).state
  const have = windowCoverage(cache.messages, cache.compactRows)
  const unchanged = await read(have)
  for (const [phase, { request, result }] of Object.entries({ cold, unchanged })) {
    const decoded = applyWindowResult(null, result, windowLookup(cache))
    if (decoded.missing.length) throw new Error(fixture + ' could not recover its cached rows')
    const frames = encoder.encode({ type: 'rpc_result', requestId: 'r', result })
    restores.push({
      fixture, phase, requestBytes: utf8(request), resultBytes: utf8(result),
      framedResultBytes: frames.reduce((sum, frame) => sum + frame.byteLength, 0),
      bodies: result.messages.flatMap((m) => m.fragments).filter((f) => f.body).length,
    })
  }
}
console.table(restores)
