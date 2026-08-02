import { describe, expect, it, vi } from 'vitest'
import {
  createNodeCodexTurnRunner,
  isCodexBinaryOverrideRunnable,
  resolveCodexBinaryPath,
} from './codex-turn-runner'
import type { NodeSessionRecord } from './session-runtime'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CodexSpawnFn } from '@superone/codex'
import type { AgentEvent } from '@superone/shared/agent-types'

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
})
