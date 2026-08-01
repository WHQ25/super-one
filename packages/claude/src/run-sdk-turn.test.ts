import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runClaudeSdkTurn } from './run-sdk-turn'
import type { ClaudeQueryFn } from './types'
import type { SessionTurnEvent } from '@superone/shared/environment'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

async function* messages(items: SDKMessage[] | Record<string, unknown>[]): AsyncGenerator<SDKMessage> {
  for (const item of items) {
    yield item as SDKMessage
  }
}

describe('runClaudeSdkTurn', () => {
  it('streams onEvent text and returns session resume id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-core-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn: ClaudeQueryFn = vi.fn(() =>
      messages([
        {
          type: 'stream_event',
          session_id: 'sess-sdk-1',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'hello' },
          },
        } as unknown as SDKMessage,
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'sess-sdk-1',
          result: 'hello',
        } as unknown as SDKMessage,
      ]),
    )

    const events: SessionTurnEvent[] = []
    const deltas: string[] = []
    const result = await runClaudeSdkTurn({
      binaryPath: bin,
      prompt: 'ping',
      cwd: dir,
      queryFn,
      onEvent: (e) => events.push(e),
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
    })

    expect(result.finalText).toBe('hello')
    expect(result.sessionId).toBe('sess-sdk-1')
    expect(deltas).toEqual([])
    expect(events.some((e) => e.kind === 'text' && e.delta === 'hello')).toBe(true)
    expect(events.some((e) => e.kind === 'status' && e.status === 'streaming')).toBe(true)
    expect(events.some((e) => e.kind === 'status' && e.status === 'idle')).toBe(true)

    const call = (queryFn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      prompt: string
      options?: Options
    }
    expect(call.prompt).toBe('ping')
    expect(call.options?.pathToClaudeCodeExecutable).toBe(bin)
    // Explicit path still wins over SDK optional package.
    expect(call.options?.includePartialMessages).toBe(true)
    expect(typeof call.options?.canUseTool).toBe('function')

    rmSync(dir, { recursive: true, force: true })
  })

  it('passes resume session id into SDK options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-core-r-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn: ClaudeQueryFn = vi.fn(() =>
      messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'prior-99',
          result: 'ok',
        } as unknown as SDKMessage,
      ]),
    )

    await runClaudeSdkTurn({
      binaryPath: bin,
      prompt: 'continue',
      cwd: dir,
      sessionId: 'prior-99',
      queryFn,
      onEvent: () => {},
      signal: new AbortController().signal,
    })

    const call = (queryFn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options?: Options
    }
    expect(call.options?.resume).toBe('prior-99')

    rmSync(dir, { recursive: true, force: true })
  })

  it('bridges canUseTool allow/deny via onPermission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-core-p-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    let canUseTool: Options['canUseTool']
    const queryFn: ClaudeQueryFn = vi.fn((params) => {
      canUseTool = params.options?.canUseTool
      return messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 's',
          result: 'done',
        } as unknown as SDKMessage,
      ])
    })

    const decisions: Array<'allow' | 'deny'> = ['allow', 'deny']
    let decisionIdx = 0
    const onPermission = vi.fn(async () => decisions[decisionIdx++] ?? 'deny')
    await runClaudeSdkTurn({
      binaryPath: bin,
      prompt: 'x',
      cwd: dir,
      queryFn,
      onPermission,
      onEvent: () => {},
      signal: new AbortController().signal,
    })

    expect(canUseTool).toBeTypeOf('function')
    const allow = await canUseTool!('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu1',
      requestId: 'req1',
    })
    expect(allow).toEqual({ behavior: 'allow' })
    expect(onPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: 'req1',
        toolName: 'Bash',
        toolUseId: 'tu1',
      }),
    )

    const deny = await canUseTool!('Bash', {}, {
      signal: new AbortController().signal,
      toolUseID: 'tu2',
      requestId: 'req2',
    })
    expect(deny).toMatchObject({ behavior: 'deny' })

    rmSync(dir, { recursive: true, force: true })
  })

  it('fail-closed when explicit binary path is missing', async () => {
    await expect(
      runClaudeSdkTurn({
        binaryPath: '/no/such/claude',
        prompt: 'x',
        cwd: '/tmp',
        queryFn: () => messages([]),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Claude binary not found/)
  })

  it('throws on result error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-core-e-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn: ClaudeQueryFn = () =>
      messages([
        {
          type: 'result',
          subtype: 'error',
          is_error: true,
          session_id: 's',
          result: 'auth failed',
        } as unknown as SDKMessage,
      ])

    await expect(
      runClaudeSdkTurn({
        binaryPath: bin,
        prompt: 'x',
        cwd: dir,
        queryFn,
        onEvent: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/auth failed/)

    rmSync(dir, { recursive: true, force: true })
  })
})
