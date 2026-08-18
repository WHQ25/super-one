import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NODE_HARNESS_IDS,
  type AuthScope,
  type HarnessInstallationStatus,
} from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'
import { PHASE4_HARNESS_IDS } from './harness-runners'
import { isCodexBinaryOverrideRunnable } from './codex-turn-runner'
import { isClaudeRuntimeRunnable } from './claude-turn-runner'
import { generateEd25519KeyPair, signPayload } from '../crypto-util'
import WebSocket from 'ws'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

function withRunnableOverrides(catalogHarnessIds: string[]): string[] {
  const harnessIds = [...catalogHarnessIds]
  if (isCodexBinaryOverrideRunnable() && !harnessIds.includes('codex')) {
    harnessIds.push('codex')
  }
  if (isClaudeRuntimeRunnable() && !harnessIds.includes('claude')) {
    harnessIds.push('claude')
  }
  return harnessIds
}

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot(opts: { simulatedHarness?: boolean; nodeHome?: string; port?: number } = {}) {
  const nodeHome = opts.nodeHome ?? mkdtempSync(join(tmpdir(), 'hm-cat-'))
  if (!opts.nodeHome) dirs.push(nodeHome)
  const port = opts.port ?? 30000 + Math.floor(Math.random() * 5000)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: port,
    simulatedHarness: opts.simulatedHarness,
  })
  runtimes.push(rt)
  return rt
}

/** Pair with a restricted scope set (not full admin). */
async function connectWithScopes(rt: NodeRuntime, scopes: readonly AuthScope[]) {
  const device = generateEd25519KeyPair()
  const pair = rt.auth.createPairingToken({ scopes: [...scopes] })
  const pairRes = await fetch(`${rt.server.url}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingToken: pair.token,
      devicePublicKeyPem: device.publicKeyPem,
      label: 'limited-client',
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
  await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => reject(new Error('handshake timeout')), 5_000)
    const onMsg = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as {
        requestId: string
        type: string
        error?: { message: string }
      }
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

  const rpc = (method: string, payload: unknown = {}) =>
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
      ws.send(
        JSON.stringify({
          type: 'rpc',
          requestId,
          method,
          payload,
          environmentId,
          protocolVersion: 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      )
    })

  return { rpc, close: () => ws.close() }
}

describe('Harness catalog (Stage 1)', () => {
  it('production descriptor includes runnable overrides while the admin catalog stays disabled', async () => {
    const rt = await boot()
    const client = await connectAuthedRpc(rt)
    const desc = (await client.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[]; sessions: boolean }
    }
    expect(desc.capabilities.sessions).toBe(true)
    expect(desc.capabilities.harnessIds).toEqual(withRunnableOverrides([]))

    const list = (await client.rpc('harness.list')) as HarnessInstallationStatus[]
    expect(list).toHaveLength(NODE_HARNESS_IDS.length)
    expect(list.map((h) => h.id).sort()).toEqual([...NODE_HARNESS_IDS].sort())
    expect(list.every((h) => h.enabled === false && h.state === 'disabled')).toBe(true)
    expect(JSON.stringify(list)).not.toMatch(/password|token|secret_ref|secretRef/i)

    const show = (await client.rpc('harness.show', {
      harnessId: 'acp-grok',
    })) as HarnessInstallationStatus
    expect(show.id).toBe('acp-grok')
    expect(show.runtimeSource).toBe('external')
    client.close()
  })

  it('descriptor harnessIds track only enabled+ready entries', async () => {
    const rt = await boot()
    const client = await connectAuthedRpc(rt)
    rt.harnesses.update('codex', { enabled: true, state: 'ready' })
    rt.harnesses.update('claude', { enabled: true, state: 'needs_auth' })
    rt.harnesses.update('acp-grok', { enabled: true, state: 'ready' })

    const desc = (await client.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[] }
    }
    expect(desc.capabilities.harnessIds).toEqual(withRunnableOverrides(['codex', 'acp']))
    client.close()
  })

  it('simulatedHarness pre-marks catalog ready for multi-harness contract tests', async () => {
    const rt = await boot({ simulatedHarness: true })
    const client = await connectAuthedRpc(rt)
    const desc = (await client.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[] }
    }
    expect(desc.capabilities.harnessIds).toEqual(PHASE4_HARNESS_IDS)
    client.close()
  })

  it('simulatedHarness does not contaminate a production restart of the same node home', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'hm-restart-'))
    dirs.push(nodeHome)
    const port = 31000 + Math.floor(Math.random() * 2000)

    const sim = await boot({ simulatedHarness: true, nodeHome, port })
    const simClient = await connectAuthedRpc(sim)
    const simDesc = (await simClient.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[] }
    }
    expect(simDesc.capabilities.harnessIds).toEqual(PHASE4_HARNESS_IDS)
    simClient.close()
    await sim.stop()
    runtimes.pop()

    const prod = await boot({ nodeHome, port: port + 1 })
    const prodClient = await connectAuthedRpc(prod)
    const prodDesc = (await prodClient.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[] }
    }
    expect(prodDesc.capabilities.harnessIds).toEqual(withRunnableOverrides([]))

    const projectDir = mkdtempSync(join(tmpdir(), 'hm-restart-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'x'), '1')
    const project = (await prodClient.rpc('project.open', { path: projectDir })) as {
      projectId: string
    }
    await expect(
      prodClient.rpc('session.create', { projectId: project.projectId, harnessId: 'codex' }),
    ).rejects.toMatchObject({ code: 'failed_precondition' })
    prodClient.close()
  })

  it('rejects session.create when the requested harness is not ready', async () => {
    const rt = await boot()
    const client = await connectAuthedRpc(rt)
    const projectDir = mkdtempSync(join(tmpdir(), 'hm-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'x'), '1')
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }

    await expect(
      client.rpc('session.create', { projectId: project.projectId, harnessId: 'codex' }),
    ).rejects.toThrow(/harness not ready|runtime unavailable/i)

    // Catalog ready alone is not enough — production also requires a real binary.
    rt.harnesses.update('codex', { enabled: true, state: 'ready' })
    await expect(
      client.rpc('session.create', { projectId: project.projectId, harnessId: 'codex' }),
    ).rejects.toThrow(/runtime unavailable/i)

    // Lab binary override satisfies the runtime gate.
    const bin = join(projectDir, 'fake-codex')
    writeFileSync(bin, '#!/bin/sh\necho ok\n')
    const { chmodSync } = await import('node:fs')
    chmodSync(bin, 0o755)
    process.env.SUPERONE_CODEX_BINARY = bin
    try {
      const session = (await client.rpc('session.create', {
        projectId: project.projectId,
        harnessId: 'codex',
      })) as { sessionId: string; harnessId: string }
      expect(session.sessionId).toBeTruthy()
      expect(session.harnessId).toBe('codex')
    } finally {
      delete process.env.SUPERONE_CODEX_BINARY
    }
    client.close()
  })

  it('normalizes acp-grok create to wire acp and completes a simulated turn', async () => {
    const rt = await boot({ simulatedHarness: true })
    const client = await connectAuthedRpc(rt)
    const projectDir = mkdtempSync(join(tmpdir(), 'hm-acp-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'x'), '1')
    const project = (await client.rpc('project.open', { path: projectDir })) as { projectId: string }

    const session = (await client.rpc('session.create', {
      projectId: project.projectId,
      harnessId: 'acp-grok',
      providerId: 'acp',
    })) as { sessionId: string; harnessId: string }
    expect(session.harnessId).toBe('acp')

    const lease = (await client.rpc('session.acquireControl', {
      sessionId: session.sessionId,
      ttlMs: 30_000,
    })) as { leaseId: string; generation: string }
    await client.rpc('session.send', {
      sessionId: session.sessionId,
      text: 'hello grok',
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    let status = 'streaming'
    let transcriptText = ''
    for (let i = 0; i < 40; i++) {
      const s = (await client.rpc('session.get', { sessionId: session.sessionId })) as {
        status: string
        transcript: Array<{ text: string }>
      }
      status = s.status
      transcriptText = s.transcript.map((t) => t.text).join('')
      if (status === 'idle') break
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(status).toBe('idle')
    expect(transcriptText).toContain('[acp]')
    client.close()
  })

  it('forbids harness.list/show without node:admin', async () => {
    const rt = await boot()
    const limited = await connectWithScopes(rt, [
      'environment:read',
      'project:read',
      'project:manage',
      'session:read',
      'session:operate',
      'workspace:read',
      'workspace:write',
    ])
    // Descriptor still works for ordinary readers.
    const desc = (await limited.rpc('environment.descriptor')) as {
      capabilities: { harnessIds: string[] }
    }
    expect(desc.capabilities.harnessIds).toEqual(withRunnableOverrides([]))

    await expect(limited.rpc('harness.list')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(limited.rpc('harness.show', { harnessId: 'codex' })).rejects.toMatchObject({
      code: 'forbidden',
    })
    limited.close()
  })

  it('returns only allowlisted diagnostic messages on admin catalog reads', async () => {
    const rt = await boot()
    // Inject a contaminated durable row as if a buggy older build stored raw errors.
    rt.db
      .prepare(
        `UPDATE harness_installations SET
           enabled = 1, state = 'error',
           diagnostic_code = 'probe_failed',
           diagnostic_message = ?,
           updated_at = ?
         WHERE harness_id = 'codex'`,
      )
      .run(
        [
          'OPENAI_API_KEY=sk-review-secret',
          'Authorization: Basic dXNlcjpwYXNz',
          'password="super secret"',
        ].join(' '),
        Date.now(),
      )

    const client = await connectAuthedRpc(rt)
    const show = (await client.rpc('harness.show', {
      harnessId: 'codex',
    })) as HarnessInstallationStatus
    expect(show.diagnostic?.code).toBe('probe_failed')
    expect(show.diagnostic?.message).toBe('readiness probe failed')
    expect(JSON.stringify(show)).not.toContain('sk-review-secret')
    expect(JSON.stringify(show)).not.toContain('dXNlcjpwYXNz')
    expect(JSON.stringify(show)).not.toContain('super secret')

    // Authoritative update rewrites DB message to the template.
    rt.harnesses.update('codex', { diagnosticCode: 'probe_failed' })
    const row = rt.db
      .prepare(
        `SELECT diagnostic_message FROM harness_installations WHERE harness_id = ?`,
      )
      .get('codex') as { diagnostic_message: string }
    expect(row.diagnostic_message).toBe('readiness probe failed')
    expect(row.diagnostic_message).not.toContain('sk-review-secret')
    client.close()
  })
})
