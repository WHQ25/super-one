/**
 * bun apps/desktop/scripts/benchmark-remote-chat-open.ts
 * Run this same script in both checkouts. Measures the desktop chat's read RPCs
 * from the window request through local frame decoding, before renderer IPC.
 */
import { handleSessionGet } from '@superone/runtime/server/rpc-session-reads'
import { handleSessionTranscriptWindow } from '@superone/runtime/server/rpc-session-window'
import type { RpcContext } from '@superone/runtime/server/rpc-context'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { ConnectionDelivery } from '@superone/runtime/stream/delivery/connection-delivery'
import { deliveryPolicy } from '@superone/runtime/stream/delivery-policy'
import { WireDecoder, WireEncoder } from '@superone/shared/environment/wire'
import type { TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { conversation } from '@superone/shared/transcript-window/window-fixtures'
import { loadRemoteTranscriptWindow } from '../src/main/environment/remote-transcript-window'

const messages = conversation(200)
const transcript = messages.map((message, i) => ({
  id: message.id, role: message.role, createdAt: i,
  text: message.content[0].type === 'text' ? message.content[0].text : '',
}))
const row = { sessionId: 's', title: 'Project history', harnessId: 'claude', providerId: 'claude',
  status: 'idle', cwd: '/repo', model: 'model', projectId: 'project' }
const results = []
for (const host of ['node', 'desktop']) {
  for (const pane of ['unmeasured', 'split']) {
    const viewport = pane === 'split' ? { width: 350, height: 600 } : undefined
    const times: number[] = []
    let measurement
    for (let i = 0; i < 35; i++) {
      const encoder = new WireEncoder(nodeWireCompression)
      const decoder = new WireDecoder(nodeWireCompression)
      const ctx = {
        client: { clientSessionId: 'controller', scopes: ['session:read'] },
        sessions: {
          get: (_id: string, options?: { includeTranscript?: boolean }) => ({ ...row,
            transcript: host === 'desktop' || options?.includeTranscript === false ? [] : transcript.map(block => ({ ...block })) }),
          load: () => ({ messages, state: { status: 'idle' }, cursor: { version: 1, sequence: '1', epoch: 'e' } }),
        },
        streams: { delivery: new ConnectionDelivery(deliveryPolicy('lan', 'desktop')) },
      } as unknown as RpcContext
      let responseBytes = 0
      let responseJson = 0
      let reads = 0
      function receive<T>(result: T): T {
        reads++
        const envelope = { type: 'rpc_result', requestId: String(reads), result }
        responseJson += Buffer.byteLength(JSON.stringify(envelope))
        let decoded: unknown
        for (const frame of encoder.encode(envelope)) {
          responseBytes += frame.byteLength
          decoded = decoder.decode(frame) ?? decoded
        }
        if (!decoded) throw new Error('Incomplete response')
        return (decoded as typeof envelope).result
      }
      const start = performance.now()
      const { snapshot } = await loadRemoteTranscriptWindow(async request => {
        // An older controller issues its session.get alongside the window. Count
        // both reads without simulating a serial network delay between them.
        if (!request.includeSessionRow) receive(handleSessionGet({ sessionId: 's' }, ctx).result)
        const reply = await handleSessionTranscriptWindow(request, ctx)
        if (reply.error) throw new Error(reply.error.message)
        return receive(reply.result as TranscriptWindowResult)
      }, null, { sessionId: 's', viewport })
      const elapsed = performance.now() - start
      if (snapshot.messages.at(-1)?.id !== messages.at(-1)?.id) throw new Error('Missing newest message')
      measurement = { host, pane, reads, rows: snapshot.messages.length, responseJson, responseBytes }
      if (i >= 5) times.push(elapsed)
    }
    times.sort((a, b) => a - b)
    results.push({ ...measurement, localMedianMs: Number(times[Math.floor(times.length / 2)].toFixed(2)) })
  }
}
console.table(results)
