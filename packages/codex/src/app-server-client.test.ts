import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  openCodexAppServer,
  runCodexAppServerTurn,
  safePublicError,
  type CodexSpawnFn,
} from './app-server-client'
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

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

function collectLines(stdin: PassThrough): string[] {
  const lines: string[] = []
  stdin.on('data', (buf: Buffer) => {
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.trim()) lines.push(line.trim())
    }
  })
  return lines
}

async function pump(): Promise<void> {
  await new Promise((r) => setTimeout(r, 25))
}

describe('codex app-server client (Stage 4)', () => {
  it('handshakes, starts turn, streams deltas, waits for turn/completed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-bin-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\nexit 0\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 100 })
    await pump()

    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { userAgent: 'test' } })}\n`,
    )
    await pump()
    const client = await openPromise

    const deltas: string[] = []
    const turnPromise = runCodexAppServerTurn({
      client,
      prompt: 'hello',
      cwd: dir,
      additionalDirectories: [join(dir, 'shared')],
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
      threadConfig: {
        mcp_servers: {
          superone: {
            url: 'http://127.0.0.1:9/mcp',
            http_headers: { Authorization: 'Bearer t' },
            startup_timeout_sec: 60,
          },
        },
      },
    })

    await pump()
    const threadReq = JSON.parse(lines.find((l) => l.includes('"thread/start"'))!)
    expect(threadReq.params.approvalPolicy).toBe('never')
    expect(threadReq.params.config.mcp_servers.superone.url).toBe('http://127.0.0.1:9/mcp')
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: threadReq.id,
        result: { thread: { id: 'thread-1' } },
      })}\n`,
    )

    await pump()
    const turnReq = JSON.parse(lines.find((l) => l.includes('"turn/start"'))!)
    expect(turnReq.params.sandboxPolicy.writableRoots).toEqual([dir, join(dir, 'shared')])
    // Real ordering: turn/start result first (turn id only), then deltas, then completed.
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: turnReq.id,
        result: { turn: { id: 'turn-1' } },
      })}\n`,
    )
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { delta: 'Hi ' },
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { delta: 'remote' },
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'turn-1', status: 'completed' } },
      })}\n`,
    )

    const result = await turnPromise
    expect(result.finalText).toBe('Hi remote')
    expect(result.threadId).toBe('thread-1')
    expect(deltas).toEqual(['Hi ', 'remote'])

    await client.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('resumes a prior thread via thread/resume on a fresh connection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-resume-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 100 })
    await pump()
    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise

    const turnPromise = runCodexAppServerTurn({
      client,
      prompt: 'again',
      cwd: dir,
      threadId: 'thread-prior',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    await pump()
    expect(lines.some((l) => l.includes('thread/resume'))).toBe(true)
    expect(lines.some((l) => l.includes('thread/start'))).toBe(false)
    const resumeReq = JSON.parse(lines.find((l) => l.includes('thread/resume'))!)
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: resumeReq.id,
        result: { thread: { id: 'thread-prior' } },
      })}\n`,
    )
    await pump()
    const turnReq = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 't2' } } })}\n`,
    )
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { delta: 'resumed' },
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 't2', status: 'completed' } },
      })}\n`,
    )

    const result = await turnPromise
    expect(result.finalText).toBe('resumed')
    expect(result.threadId).toBe('thread-prior')
    await client.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers inbound server requests with deny so on-request cannot hang', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-req-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 100 })
    await pump()
    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise

    // Server asks for permission (method + id).
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'item/requestApproval',
        params: { tool: 'shell' },
      })}\n`,
    )
    await pump()
    const reply = lines.map((l) => JSON.parse(l)).find((o) => o.id === 99)
    expect(reply?.result?.decision ?? reply?.result?.outcome?.decision).toBe('deny')

    await client.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fails closed when binary path is missing', async () => {
    await expect(
      openCodexAppServer({ binaryPath: '/no/such/codex-binary' }),
    ).rejects.toThrow(/not found/)
  })

  it('safePublicError redacts secret-like substrings', () => {
    const err = safePublicError('fail', new Error('token=super-secret-value'))
    expect(err.message).not.toContain('super-secret-value')
  })

  it('fails the turn immediately when the child exits after turn/start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-exit-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 50 })
    await pump()
    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise

    const turnPromise = runCodexAppServerTurn({
      client,
      prompt: 'hi',
      cwd: dir,
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    await pump()
    const thr = JSON.parse(lines.find((l) => l.includes('thread/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: thr.id, result: { thread: { id: 't1' } } })}\n`,
    )
    await pump()
    const turn = JSON.parse(lines.find((l) => l.includes('turn/start'))!)
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: turn.id, result: { turn: { id: 'u1' } } })}\n`,
    )
    await pump()
    // Process dies before turn/completed — must not hot-loop for 5 minutes.
    child.emit('exit', 1, null)
    await expect(turnPromise).rejects.toThrow(/exited unexpectedly|closed/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('escalates to SIGKILL when SIGTERM does not exit the child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-kill-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const signals: Array<string | number | undefined> = []
    const child = createFakeChild()
    // Override kill: record signals; only exit on SIGKILL.
    child.kill = (sig?: NodeJS.Signals | number) => {
      signals.push(sig)
      if (sig === 'SIGKILL') {
        child.killed = true
        queueMicrotask(() => child.emit('exit', 0, 'SIGKILL'))
        child.stdout.end()
      }
      // SIGTERM: pretend process ignores it (Node still sets .killed on real
      // processes; we intentionally do NOT set child.killed here so our
      // processExited tracking is what matters).
      return true
    }
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 30 })
    await pump()
    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise

    await client.close()
    // Allow escalation timer to fire.
    await new Promise((r) => setTimeout(r, 80))
    expect(signals).toContain('SIGTERM')
    expect(signals).toContain('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  })

  it('turnKind=compact issues thread/compact/start and waits for turn/completed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-compact-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({ binaryPath: bin, spawnFn, killTimeoutMs: 100 })
    await pump()
    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise

    const turnPromise = runCodexAppServerTurn({
      client,
      prompt: 'compact',
      cwd: dir,
      threadId: 't-c',
      turnKind: 'compact',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    await pump()
    const resumeReq = JSON.parse(lines.find((l) => l.includes('thread/resume'))!)
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: resumeReq.id,
        result: { thread: { id: 't-c' } },
      })}\n`,
    )
    await pump()
    const settingsReq = JSON.parse(lines.find((l) => l.includes('thread/settings/update'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: settingsReq.id, result: {} })}\n`)
    await pump()
    expect(lines.some((l) => l.includes('thread/compact/start'))).toBe(true)
    const compactReq = JSON.parse(lines.find((l) => l.includes('thread/compact/start'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: compactReq.id, result: {} })}\n`)
    await pump()
    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { turn: { id: 'c1', status: 'completed' } },
      })}\n`,
    )
    const result = await turnPromise
    expect(result.finalText).toMatch(/compact/i)
    expect(result.threadId).toBe('t-c')
    await client.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('spawns app-server with loopback NO_PROXY so system proxies skip SuperOne MCP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-noproxy-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const child = createFakeChild()
    const lines = collectLines(child.stdin)
    const spawnFn: CodexSpawnFn = vi.fn(() => asSpawnChild(child))

    const openPromise = openCodexAppServer({
      binaryPath: bin,
      spawnFn,
      killTimeoutMs: 100,
      env: { NO_PROXY: 'example.com' },
    })
    await pump()

    expect(spawnFn).toHaveBeenCalled()
    const spawnOpts = vi.mocked(spawnFn).mock.calls[0]![2]
    const noProxy = String(spawnOpts.env.NO_PROXY ?? '')
    expect(noProxy.split(',')).toContain('example.com')
    expect(noProxy.split(',')).toContain('127.0.0.1')
    expect(noProxy.split(',')).toContain('localhost')
    expect(noProxy.split(',')).toContain('::1')
    expect(spawnOpts.env.no_proxy).toBe(noProxy)

    const initReq = JSON.parse(lines.find((l) => l.includes('"initialize"'))!)
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: {} })}\n`)
    const client = await openPromise
    await client.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
