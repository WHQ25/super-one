import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  applyClaudeNdjsonRecord,
  buildClaudeControlResponse,
  buildClaudePrintArgs,
  extractClaudeAssistantText,
  extractClaudeStreamDelta,
  runClaudePrintTurn,
  type ClaudeSpawnFn,
} from './claude-print-client'
import type { SessionTurnEvent } from '@superone/shared/environment'
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeChildProcess } from './claude-print-client'

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
      queueMicrotask(() => {
        ee.emit('exit', 0, null)
        stdout.end()
      })
      return true
    },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    emit: ee.emit.bind(ee),
  }
  return child
}

function asSpawnChild(child: FakeChild): ClaudeChildProcess {
  return child as unknown as ClaudeChildProcess
}

async function pump(ms = 20) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('claude print client helpers', () => {
  it('builds print args with resume and model (no skip-permissions)', () => {
    expect(buildClaudePrintArgs({ prompt: 'hi' })).toEqual([
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ])
    expect(
      buildClaudePrintArgs({ prompt: 'x', sessionId: 'sid-1', model: 'claude-opus' }),
    ).toEqual([
      '-p',
      'x',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--resume',
      'sid-1',
      '--model',
      'claude-opus',
    ])
  })

  it('extracts text_delta from stream_event', () => {
    expect(
      extractClaudeStreamDelta({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } },
      }),
    ).toBe('ab')
    expect(extractClaudeStreamDelta({ type: 'assistant' })).toBeNull()
  })

  it('extracts assistant text blocks', () => {
    expect(
      extractClaudeAssistantText({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', name: 'Bash' },
            { type: 'text', text: ' world' },
          ],
        },
      }),
    ).toBe('hello world')
  })

  it('projects tool start / input_delta / result into SessionTurnEvent', () => {
    const events: SessionTurnEvent[] = []
    const state = {
      openTools: new Map(),
      textBlockId: 't',
      indexToToolId: new Map<number, string>(),
      indexToKind: new Map<number, 'text' | 'tool_use'>(),
    }
    applyClaudeNdjsonRecord(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu1', name: 'Bash' },
        },
      },
      state,
      (e) => events.push(e),
    )
    applyClaudeNdjsonRecord(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"cmd":' },
        },
      },
      state,
      (e) => events.push(e),
    )
    applyClaudeNdjsonRecord(
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }],
        },
      },
      state,
      (e) => events.push(e),
    )
    expect(events).toEqual([
      {
        kind: 'tool',
        phase: 'started',
        toolUseId: 'tu1',
        toolName: 'Bash',
        parentToolUseId: null,
      },
      {
        kind: 'tool',
        phase: 'input_delta',
        toolUseId: 'tu1',
        toolName: 'Bash',
        input: '{"cmd":',
        parentToolUseId: null,
      },
      {
        kind: 'tool',
        phase: 'completed',
        toolUseId: 'tu1',
        toolName: 'Bash',
        output: 'ok',
        parentToolUseId: null,
      },
    ])
  })
})

describe('runClaudePrintTurn', () => {
  it('streams deltas, returns session id from result, and passes resume args', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-bin-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: ClaudeSpawnFn = vi.fn(() => asSpawnChild(child))
    const deltas: string[] = []

    const turnP = runClaudePrintTurn({
      binaryPath: bin,
      prompt: 'ping',
      cwd: dir,
      sessionId: 'prior-session',
      spawnFn,
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
      killTimeoutMs: 100,
    })

    await pump()
    expect(spawnFn).toHaveBeenCalled()
    const [, args] = (spawnFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string[],
      unknown,
    ]
    expect(args).toContain('--resume')
    expect(args).toContain('prior-session')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')

    child.stdout.write(
      `${JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'new-session-1',
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'pong' },
        },
        session_id: 'new-session-1',
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'new-session-1',
        result: 'pong',
      })}\n`,
    )
    child.stdout.end()
    queueMicrotask(() => child.emit('exit', 0, null))

    const result = await turnP
    expect(result.finalText).toBe('pong')
    expect(result.sessionId).toBe('new-session-1')
    expect(deltas).toEqual(['pong'])

    rmSync(dir, { recursive: true, force: true })
  })

  it('fails closed on result is_error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-bin-err-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: ClaudeSpawnFn = vi.fn(() => asSpawnChild(child))

    const turnP = runClaudePrintTurn({
      binaryPath: bin,
      prompt: 'x',
      cwd: dir,
      spawnFn,
      onDelta: () => {},
      signal: new AbortController().signal,
      killTimeoutMs: 100,
    })

    await pump()
    child.stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        session_id: 's-err',
        result: 'auth failed',
      })}\n`,
    )
    child.stdout.end()
    queueMicrotask(() => child.emit('exit', 1, null))

    await expect(turnP).rejects.toThrow(/auth failed|Claude turn failed/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('interrupts on abort signal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-bin-abort-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: ClaudeSpawnFn = vi.fn(() => asSpawnChild(child))
    const ac = new AbortController()

    const turnP = runClaudePrintTurn({
      binaryPath: bin,
      prompt: 'x',
      cwd: dir,
      spawnFn,
      onDelta: () => {},
      signal: ac.signal,
      killTimeoutMs: 50,
    })

    await pump()
    ac.abort()
    await expect(turnP).rejects.toThrow(/interrupted/)
    expect(child.killed).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers onEvent for text and does not dual-path onDelta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-bin-onevent-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: ClaudeSpawnFn = vi.fn(() => asSpawnChild(child))
    const deltas: string[] = []
    const events: SessionTurnEvent[] = []

    const turnP = runClaudePrintTurn({
      binaryPath: bin,
      prompt: 'hi',
      cwd: dir,
      spawnFn,
      onDelta: (d) => deltas.push(d),
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
      killTimeoutMs: 100,
      defaultTextBlockId: 'blk-1',
    })

    await pump()
    child.stdout.write(
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hey' },
        },
        session_id: 's-ev',
      })}\n`,
    )
    child.stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's-ev',
        result: 'hey',
      })}\n`,
    )
    child.stdout.end()
    queueMicrotask(() => child.emit('exit', 0, null))

    const result = await turnP
    expect(result.finalText).toBe('hey')
    expect(deltas).toEqual([])
    expect(events.some((e) => e.kind === 'status' && e.status === 'streaming')).toBe(true)
    expect(events).toContainEqual({ kind: 'text', blockId: 'blk-1', delta: 'hey' })
    expect(events).toContainEqual({
      kind: 'text',
      blockId: 'blk-1',
      final: true,
      text: 'hey',
    })
    expect(events.some((e) => e.kind === 'status' && e.status === 'idle')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it('answers can_use_tool control_request via onPermission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-bin-perm-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const child = createFakeChild()
    const spawnFn: ClaudeSpawnFn = vi.fn(() => asSpawnChild(child))
    const stdinLines: string[] = []
    child.stdin.on('data', (b: Buffer) => {
      for (const line of b.toString().split('\n')) if (line.trim()) stdinLines.push(line.trim())
    })
    const onPermission = vi.fn(async () => 'allow' as const)

    const turnP = runClaudePrintTurn({
      binaryPath: bin,
      prompt: 'edit file',
      cwd: dir,
      spawnFn,
      onDelta: () => {},
      onPermission,
      signal: new AbortController().signal,
      killTimeoutMs: 100,
    })

    await pump()
    child.stdout.write(
      `${JSON.stringify({
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Edit',
          tool_use_id: 'tu-9',
          input: { file_path: 'a.ts' },
        },
      })}\n`,
    )
    await pump(40)
    expect(onPermission).toHaveBeenCalled()
    expect(stdinLines.length).toBeGreaterThan(0)
    const resp = JSON.parse(stdinLines[0]!)
    expect(resp).toEqual(
      buildClaudeControlResponse({ requestId: 'req-1', decision: 'allow' }),
    )

    child.stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's-perm',
        result: 'done',
      })}\n`,
    )
    child.stdout.end()
    queueMicrotask(() => child.emit('exit', 0, null))

    const result = await turnP
    expect(result.finalText).toBe('done')
    rmSync(dir, { recursive: true, force: true })
  })
})
