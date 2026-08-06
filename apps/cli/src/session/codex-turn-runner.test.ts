import { describe, expect, it, vi } from 'vitest'
import {
  createNodeCodexTurnRunner,
  isCodexBinaryOverrideRunnable,
  resolveCodexBinaryPath,
} from './codex-turn-runner'
import type { NodeSessionRecord } from './session-runtime'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CodexSpawnFn } from '@superone/codex'
import type { AgentEvent } from '@superone/shared/agent-types'
import { shutdownAll as shutdownAllProxies } from '@superone/runtime/llm-proxy'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from '../provider/provider-store'

function session(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'codex',
    providerId: 'codex',
    title: null,
    status: 'streaming',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    ...over,
  }
}

type FakeChild = {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill: (sig?: NodeJS.Signals | number) => boolean
  on: EventEmitter['on']
  once: EventEmitter['once']
  emit: EventEmitter['emit']
}

function createFakeChild(): FakeChild {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const ee = new EventEmitter()
  const child: FakeChild = {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill(_sig?: NodeJS.Signals | number) {
      child.killed = true
      queueMicrotask(() => ee.emit('exit', 0, null))
      stdout.end()
      return true
    },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    emit: ee.emit.bind(ee),
  }
  return child
}

function asSpawnChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

async function pump(ms = 30) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('createNodeCodexTurnRunner', () => {
  it('resolves binary from explicit path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    expect(resolveCodexBinaryPath({ binaryPath: bin })).toBe(bin)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to simulated when allowSimulatedFallback and no binary', async () => {
    const runner = createNodeCodexTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: true,
      binaryPath: null,
    })
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(result.finalText.length).toBeGreaterThan(0)
  })

  it('fail-closed without binary when simulated fallback is disabled', async () => {
    const runner = createNodeCodexTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: false,
      binaryPath: null,
    })
    await expect(
      runner({
        session: session(),
        text: 'hi',
        onDelta: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Codex binary not available/)
  })

  it('drives a fake app-server with turn/completed after turn/start result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr2-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      allowSimulatedFallback: false,
    })

    const deltas: string[] = []
    const agentEvents: AgentEvent[] = []
    const turnP = runner({
      session: session(),
      text: 'ping',
      onDelta: (d) => deltas.push(d),
      onAgentEvent: (event) => agentEvents.push(event),
      signal: new AbortController().signal,
    })

    await pump()
    const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)

    await pump()
    const thr = JSON.parse(lines.find((l) => l.includes('thread/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: thr.id, result: { thread: { id: 't-abc' } } })}\n`,
    )

    await pump()
    const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u1' } } })}\n`,
    )
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { itemId: 'answer-1', delta: 'pong' },
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'u1', status: 'completed' } },
      })}\n`,
    )

    const result = await turnP
    expect(result.finalText).toBe('pong')
    expect(result.providerResume).toBe('thread:t-abc')
    expect(deltas).toEqual([])
    expect(agentEvents.map((event) => event.type)).toEqual([
      'message_start',
      'status_change',
      'codex_thread_started',
      'codex_item_delta',
      'message_complete',
      'status_change',
    ])

    rmSync(dir, { recursive: true, force: true })
  })

  it('second turn uses thread/resume with providerResume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr3-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      allowSimulatedFallback: false,
    })

    const turnP = runner({
      session: session({ providerResume: 'thread:prior-1' }),
      text: 'continue',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    await pump()
    const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
    await pump()
    expect(lines.some((l) => l.includes('thread/resume'))).toBe(true)
    const resume = JSON.parse(lines.find((l) => l.includes('thread/resume'))!)
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: resume.id,
        result: { thread: { id: 'prior-1' } },
      })}\n`,
    )
    await pump()
    const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u2' } } })}\n`,
    )
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'u2', status: 'completed' } },
      })}\n`,
    )

    const result = await turnP
    expect(result.providerResume).toBe('thread:prior-1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('picks loopback proxy base URL for openai-chat credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-proxy-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(dir, 'provider-secrets.key'))
    providers.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [{ id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] }],
        },
      ],
    })
    const cred = providers.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-upstream-secret',
    })
    providers.setBinding({ consumer: 'chat:codex', credentialId: cred.id })

    const child = createFakeChild()
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })
    let capturedEnv: NodeJS.ProcessEnv | undefined
    const spawnFn: CodexSpawnFn = vi.fn((_bin, _args, opts) => {
      capturedEnv = opts.env
      return asSpawnChild(child)
    })

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      providers,
      allowSimulatedFallback: false,
    })

    try {
      const turnP = runner({
        session: session(),
        text: 'ping',
        onDelta: () => {},
        signal: new AbortController().signal,
      })

      await pump()
      const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
      child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
      await pump()
      const thr = JSON.parse(lines.find((l) => l.includes('thread/start'))!)
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: thr.id, result: { thread: { id: 't-proxy' } } })}\n`,
      )
      await pump()
      const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u1' } } })}\n`,
      )
      await pump()
      child.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { turn: { id: 'u1', status: 'completed' } },
        })}\n`,
      )
      await turnP

      expect(capturedEnv?.OPENAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(capturedEnv?.CODEX_BASE_URL).toBe(capturedEnv?.OPENAI_BASE_URL)
      expect(capturedEnv?.CODEX_API_KEY).toBe('sk-superone-proxy')
      const health = await fetch(`${capturedEnv?.OPENAI_BASE_URL}/health`)
      expect(health.ok).toBe(true)
    } finally {
      await shutdownAllProxies()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reopens long-lived connection when provider proxy env changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-env-reopen-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(dir, 'provider-secrets.key'))
    providers.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [{ id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] }],
        },
      ],
    })
    const chatCred = providers.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-upstream-secret',
    })
    const nativeCred = providers.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'oai-native',
      secret: 'sk-openai-native-key',
    })
    providers.setBinding({ consumer: 'chat:codex', credentialId: chatCred.id })

    type Spawned = { child: FakeChild; lines: string[]; env: NodeJS.ProcessEnv | undefined }
    const spawned: Spawned[] = []
    const spawnFn: CodexSpawnFn = vi.fn((_bin, _args, spawnOpts) => {
      const child = createFakeChild()
      const lines: string[] = []
      child.stdin.on('data', (b: Buffer) => {
        for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
      })
      spawned.push({ child, lines, env: spawnOpts.env })
      return asSpawnChild(child)
    })

    const completeTurn = async (entry: Spawned, turnId: string) => {
      await pump()
      const init = JSON.parse(entry.lines.find((l) => l.includes('initialize'))!)
      entry.child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
      await pump()
      const thrLine =
        entry.lines.find((l) => l.includes('thread/start')) ??
        entry.lines.find((l) => l.includes('thread/resume'))
      const thr = JSON.parse(thrLine!)
      entry.child.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: thr.id,
          result: { thread: { id: `t-${turnId}` } },
        })}\n`,
      )
      await pump()
      const turn = JSON.parse(entry.lines.find((l) => l.includes('turn/start'))!)
      entry.child.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: turnId } } })}\n`,
      )
      await pump()
      entry.child.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { turn: { id: turnId, status: 'completed' } },
        })}\n`,
      )
    }

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      providers,
      allowSimulatedFallback: false,
    })

    try {
      // Turn 1: openai-chat → loopback proxy
      const turn1P = runner({
        session: session({ sessionId: 'env-reopen' }),
        text: 'first',
        onDelta: () => {},
        signal: new AbortController().signal,
      })
      await pump()
      expect(spawned).toHaveLength(1)
      await completeTurn(spawned[0]!, 'u1')
      await turn1P
      expect(spawned[0]!.env?.CODEX_API_KEY).toBe('sk-superone-proxy')
      expect(spawned[0]!.env?.OPENAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      // Switch binding to native openai-responses credential
      providers.setBinding({ consumer: 'chat:codex', credentialId: nativeCred.id })

      const turn2P = runner({
        session: session({ sessionId: 'env-reopen', providerResume: 'thread:t-u1' }),
        text: 'second',
        onDelta: () => {},
        signal: new AbortController().signal,
      })
      await pump()
      // Provider env fingerprint changed → must respawn app-server
      expect(spawnFn).toHaveBeenCalledTimes(2)
      expect(spawned).toHaveLength(2)
      await completeTurn(spawned[1]!, 'u2')
      await turn2P

      expect(spawned[1]!.env?.CODEX_API_KEY).toBe('sk-openai-native-key')
      // Native openai-responses: real key, no loopback proxy base URL.
      expect(spawned[1]!.env?.CODEX_API_KEY).not.toBe('sk-superone-proxy')
      expect(spawned[1]!.env?.OPENAI_BASE_URL ?? '').not.toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      await runner.disposeSession?.('env-reopen')
    } finally {
      await shutdownAllProxies()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects SUPERONE_CODEX_BINARY override', () => {
    const prev = process.env.SUPERONE_CODEX_BINARY
    const dir = mkdtempSync(join(tmpdir(), 'cbr4-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    process.env.SUPERONE_CODEX_BINARY = bin
    expect(isCodexBinaryOverrideRunnable()).toBe(true)
    process.env.SUPERONE_CODEX_BINARY = '/nope'
    expect(isCodexBinaryOverrideRunnable()).toBe(false)
    if (prev === undefined) delete process.env.SUPERONE_CODEX_BINARY
    else process.env.SUPERONE_CODEX_BINARY = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('merges enabled disk MCP into threadConfig.mcp_servers with host-action superone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-codex-mcp-'))
    const home = mkdtempSync(join(tmpdir(), 'cbr-codex-mcp-home-'))
    const codexHome = join(home, '.codex')
    mkdirSync(codexHome, { recursive: true })
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    writeFileSync(
      join(codexHome, 'config.toml'),
      `[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
`,
    )

    const child = createFakeChild()
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      allowSimulatedFallback: false,
      homeDir: home,
      codexHome,
      getCodexHostActionMcp: () => ({
        url: 'http://127.0.0.1:9/mcp',
        http_headers: { Authorization: 'Bearer t' },
        startup_timeout_sec: 60,
      }),
    })

    const turnP = runner({
      session: session(),
      text: 'ping',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    await pump()
    const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
    await pump()
    const thr = JSON.parse(lines.find((l) => l.includes('thread/start'))!)
    expect(thr.params.config.mcp_servers.superone.url).toBe('http://127.0.0.1:9/mcp')
    expect(thr.params.config.mcp_servers.linear.url).toBe('https://mcp.linear.app/mcp')
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: thr.id, result: { thread: { id: 't-m' } } })}\n`,
    )
    await pump()
    const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u1' } } })}\n`,
    )
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'u1', status: 'completed' } },
      })}\n`,
    )
    await turnP

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('turnKind=compact issues thread/compact/start on the app-server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-compact-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      allowSimulatedFallback: false,
    })

    const turnP = runner({
      session: session({ providerResume: 'thread:t-c' }),
      text: '/compact',
      turnKind: 'compact',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    await pump()
    const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
    await pump()
    const resume = JSON.parse(lines.find((l) => l.includes('thread/resume'))!)
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: resume.id,
        result: { thread: { id: 't-c' } },
      })}\n`,
    )
    await pump()
    expect(lines.some((l) => l.includes('thread/compact/start'))).toBe(true)
    const compact = JSON.parse(lines.find((l) => l.includes('thread/compact/start'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: compact.id, result: {} })}\n`)
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'c1', status: 'completed' } },
      })}\n`,
    )
    const result = await turnP
    expect(result.finalText).toMatch(/compact/i)
    expect(result.providerResume).toBe('thread:t-c')
    rmSync(dir, { recursive: true, force: true })
  })

  it('turnKind=steer reuses long-lived connection and issues turn/steer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-steer-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const lines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) lines.push(line.trim())
    })
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const runner = createNodeCodexTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      spawnFn,
      allowSimulatedFallback: false,
    })

    // Start a long-running turn; leave it open until steer lands.
    const ac = new AbortController()
    const turnP = runner({
      session: session({ sessionId: 'steer-s' }),
      text: 'long run',
      turnKind: 'run',
      onDelta: () => {},
      signal: ac.signal,
    })

    await pump()
    const init = JSON.parse(lines.find((l) => l.includes('initialize'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: init.id, result: {} })}\n`)
    await pump()
    const thr = JSON.parse(lines.find((l) => l.includes('thread/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: thr.id, result: { thread: { id: 't-s' } } })}\n`,
    )
    await pump()
    const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u-active' } } })}\n`,
    )
    await pump(50)

    // Concurrent steer on same session while turn is open.
    const steerP = runner({
      session: session({ sessionId: 'steer-s', providerResume: 'thread:t-s' }),
      text: 'nudge',
      turnKind: 'steer',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    await pump()
    expect(lines.some((l) => l.includes('turn/steer'))).toBe(true)
    const steerReq = JSON.parse(lines.find((l) => l.includes('turn/steer'))!)
    expect(steerReq.params.expectedTurnId).toBe('u-active')
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: steerReq.id, result: {} })}\n`)
    const steerResult = await steerP
    expect(steerResult.skipAssistantTranscript).toBe(true)

    // Complete original turn
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'u-active', status: 'completed' } },
      })}\n`,
    )
    await turnP

    expect(spawnFn).toHaveBeenCalledTimes(1)
    await runner.disposeSession?.('steer-s')
    rmSync(dir, { recursive: true, force: true })
  })
})
