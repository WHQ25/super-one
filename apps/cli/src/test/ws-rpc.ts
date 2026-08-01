import WebSocket from 'ws'
import { generateEd25519KeyPair, signPayload } from '../crypto-util'
import type { NodeRuntime } from '../runtime'

/** Pair + mint ticket + open WS with device PoP for integration tests. */
export async function connectAuthedRpc(rt: NodeRuntime, label = 'test-client') {
  const device = generateEd25519KeyPair()
  const pair = rt.auth.createPairingToken()
  const pairRes = await fetch(`${rt.server.url}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingToken: pair.token,
      devicePublicKeyPem: device.publicKeyPem,
      label,
    }),
  })
  const paired = (await pairRes.json()) as {
    refreshToken: string
    clientSessionId: string
    environmentId: string
  }
  const proofPayload = `refresh:${paired.clientSessionId}:${Date.now()}`
  const tokenRes = await fetch(`${rt.server.url}/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refreshToken: paired.refreshToken,
      proofPayload,
      proofSignature: signPayload(device.privateKeyPem, proofPayload),
    }),
  })
  const tokens = (await tokenRes.json()) as { accessToken: string; refreshToken: string }
  const ticketRes = await fetch(`${rt.server.url}/v1/ws-ticket`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const { ticket } = (await ticketRes.json()) as { ticket: string }
  const ticketId = ticket.split('.')[0] || ticket
  const sig = signPayload(device.privateKeyPem, ticketId)

  const ws = new WebSocket(`${rt.server.url.replace(/^http/, 'ws')}/ws`, {
    headers: {
      'x-superone-ws-ticket': ticket,
      'x-superone-ws-proof': ticketId,
      'x-superone-ws-sig': sig,
    },
  })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })

  const environmentId = paired.environmentId || rt.identity.environmentId

  // Explicit range handshake before non-bootstrap RPC
  await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => reject(new Error('handshake timeout')), 5_000)
    const onMsg = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { requestId: string; type: string; error?: { message: string } }
      if (msg.requestId !== requestId) return
      clearTimeout(timer)
      ws.off('message', onMsg)
      if (msg.type === 'rpc_error') reject(new Error(msg.error?.message || 'handshake failed'))
      else resolve()
    }
    ws.on('message', onMsg)
    ws.send(
      JSON.stringify({
        type: 'handshake',
        requestId,
        payload: {
          protocol: { current: 1, min: 1, max: 1 },
          databaseSchema: { current: 1, min: 1, max: 1 },
        },
      }),
    )
  })

  const rpc = (method: string, payload: unknown = {}, idempotencyKey?: string) =>
    new Promise<unknown>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000)
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as {
          requestId: string
          type: string
          result?: unknown
          error?: { code: string; message: string }
        }
        if (msg.requestId !== requestId) return
        clearTimeout(timer)
        ws.off('message', onMsg)
        if (msg.type === 'rpc_error') {
          reject(Object.assign(new Error(msg.error?.message || 'err'), { code: msg.error?.code }))
        } else resolve(msg.result)
      }
      ws.on('message', onMsg)
      const mutating = !method.startsWith('environment.') && !method.startsWith('session.get') && !method.startsWith('session.list') && !method.startsWith('session.events') && !method.startsWith('session.snapshot') && !method.startsWith('project.get') && !method.startsWith('project.list') && !method.startsWith('workspace.list') && !method.startsWith('workspace.read') && !method.startsWith('workspace.search') && !method.startsWith('workspace.watchPoll') && !method.startsWith('git.') && !method.startsWith('collaboration.list') && !method.startsWith('terminal.attach') && !method.startsWith('terminal.read')
      const key =
        idempotencyKey ??
        (mutating ? crypto.randomUUID() : undefined)
      ws.send(
        JSON.stringify({
          type: 'rpc',
          requestId,
          method,
          payload,
          environmentId,
          protocolVersion: 1,
          idempotencyKey: key,
        }),
      )
    })

  return {
    rpc,
    close: () => ws.close(),
    device,
    clientSessionId: paired.clientSessionId,
    environmentId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
  }
}
