import { describe, expect, it, vi } from 'vitest'
import {
  createNodeClaudeTurnRunner,
  formatClaudeSessionResume,
  isClaudeBinaryOverrideRunnable,
  parseClaudeSessionResume,
  resolveClaudeBinaryPath,
} from './claude-turn-runner'
import { createProductionTurnRunner } from './codex-turn-runner'
import type { NodeSessionRecord } from './session-runtime'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeQueryFn } from '@superone/claude'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

function session(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'claude',
    providerId: 'claude',
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
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    ...over,
  }
}

/** Loose mock stream — SDK message shapes are not fully constructed in tests. */
async function* messages(
  items: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const item of items) {
    yield item
  }
}

describe('claude resume helpers', () => {
  it('formats and parses claude-session providerResume', () => {
    expect(formatClaudeSessionResume('abc')).toBe('claude-session:abc')
    expect(parseClaudeSessionResume('claude-session:abc')).toBe('abc')
    expect(parseClaudeSessionResume('thread:xyz')).toBeNull()
    expect(parseClaudeSessionResume(null)).toBeNull()
  })
})

describe('createNodeClaudeTurnRunner', () => {
  it('resolves binary from explicit path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    expect(resolveClaudeBinaryPath({ binaryPath: bin })).toBe(bin)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to simulated when allowSimulatedFallback and no binary', async () => {
    const runner = createNodeClaudeTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: true,
      binaryPath: null,
      skipSdkBinary: true,
    })
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(result.finalText).toContain('claude')
  })

  it('fail-closed without binary when simulated fallback is disabled', async () => {
    const runner = createNodeClaudeTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: false,
      binaryPath: null,
      skipSdkBinary: true,
    })
    await expect(
      runner({
        session: session(),
        text: 'hi',
        onDelta: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Claude Agent SDK binary not available/)
  })

  it('uses Agent SDK bundled binary when no explicit path (not print-mode PATH claude)', async () => {
    // On developer machines the SDK optional package is present; resolution
    // must not require SUPERONE_CLAUDE_BINARY.
    const prev = process.env.SUPERONE_CLAUDE_BINARY
    delete process.env.SUPERONE_CLAUDE_BINARY
    try {
      const path = resolveClaudeBinaryPath({ binaryPath: null })
      // Either SDK optional package or null in stripped CI — both acceptable.
      if (path) {
        expect(path).toMatch(/claude-agent-sdk/)
        expect(isClaudeBinaryOverrideRunnable()).toBe(true)
      }
    } finally {
      if (prev === undefined) delete process.env.SUPERONE_CLAUDE_BINARY
      else process.env.SUPERONE_CLAUDE_BINARY = prev
    }
  })

  it('drives a mock SDK stream and stores claude-session resume via onEvent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude2-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(() =>
      messages([
        {
          type: 'stream_event',
          session_id: 'sess-99',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          },
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'sess-99',
          result: 'ok',
        },
      ]),
    ) as unknown as ClaudeQueryFn

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })

    const deltas: string[] = []
    const events: Array<{ kind: string; delta?: string }> = []
    const result = await runner({
      session: session(),
      text: 'ping',
      onDelta: (d) => deltas.push(d),
      onEvent: (e) => events.push(e as { kind: string; delta?: string }),
      signal: new AbortController().signal,
    })

    expect(result.finalText).toBe('ok')
    expect(result.providerResume).toBe('claude-session:sess-99')
    // Prefer onEvent — do not dual-path text via onDelta.
    expect(deltas).toEqual([])
    expect(events.some((e) => e.kind === 'text' && e.delta === 'ok')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers the lossless AgentEvent core when the runtime provides it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-agent-events-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const queryFn = vi.fn(() => messages([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reason' } },
      },
      { type: 'system', subtype: 'task_started', task_id: 'bg1', description: 'work' },
      { type: 'prompt_suggestion', suggestion: 'next' },
      { type: 'result', subtype: 'success', session_id: 'sess-rich', result: 'done' },
    ])) as unknown as ClaudeQueryFn
    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })
    const agentEvents: AgentEvent[] = []
    const structuredEvents: unknown[] = []
    const deltas: string[] = []

    await runner({
      session: session(),
      messageId: 'assistant-1',
      text: 'ping',
      onAgentEvent: (event) => agentEvents.push(event),
      onEvent: (event) => structuredEvents.push(event),
      onDelta: (delta) => deltas.push(delta),
      signal: new AbortController().signal,
    })

    expect(agentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'content_delta', messageId: 'assistant-1', delta: expect.objectContaining({ type: 'thinking' }) }),
      expect.objectContaining({ type: 'task_started', taskId: 'bg1' }),
      expect.objectContaining({ type: 'prompt_suggestion', suggestion: 'next' }),
      expect.objectContaining({ type: 'message_complete', messageId: 'assistant-1' }),
    ]))
    expect(structuredEvents).toEqual([])
    expect(deltas).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  it('forwards turn model to SDK options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-model-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(() =>
      messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'm1',
          result: 'ok',
        },
      ]),
    ) as unknown as ClaudeQueryFn

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })

    await runner({
      session: session(),
      text: 'ping',
      model: 'claude-sonnet-4-5',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ model: 'claude-sonnet-4-5' }),
      }),
    )
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes Host Action SDK MCP into options.mcpServers and disposes after turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(() =>
      messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'm1',
          result: 'ok',
        },
      ]),
    ) as unknown as ClaudeQueryFn

    const dispose = vi.fn(async () => {})
    const sdkInstance = { type: 'sdk', name: 'superone', instance: { id: 'mcp-1' } }

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      createHostActionClaudeMcp: (sessionId) => {
        expect(sessionId).toBe('node-sid-42')
        return {
          mcpServers: { superone: sdkInstance as never },
          dispose,
        }
      },
    })

    await runner({
      session: session({ sessionId: 'node-sid-42' }),
      text: 'snap',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          strictMcpConfig: true,
          mcpServers: { superone: sdkInstance },
        }),
      }),
    )
    expect(dispose).toHaveBeenCalledTimes(1)

    rmSync(dir, { recursive: true, force: true })
  })

  it('second turn passes resume from providerResume to SDK options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude3-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(() =>
      messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'prior-42',
          result: 'cont',
        },
      ]),
    ) as unknown as ClaudeQueryFn

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })

    const result = await runner({
      session: session({ providerResume: 'claude-session:prior-42' }),
      text: 'continue',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    const call = (queryFn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options?: Options
    }
    expect(call.options?.resume).toBe('prior-42')
    expect(result.providerResume).toBe('claude-session:prior-42')
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers Agent SDK bundle over SUPERONE_CLAUDE_BINARY when both exist', () => {
    const prev = process.env.SUPERONE_CLAUDE_BINARY
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude4-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, 'x')
    chmodSync(bin, 0o755)
    process.env.SUPERONE_CLAUDE_BINARY = bin
    const resolved = resolveClaudeBinaryPath({})
    // SDK package wins when installed; env is last-resort only.
    if (resolved && resolved.includes('claude-agent-sdk')) {
      expect(resolved).not.toBe(bin)
    } else {
      // No optional SDK package in this environment — env pin is used.
      expect(resolved).toBe(bin)
    }
    process.env.SUPERONE_CLAUDE_BINARY = '/nope'
    const fallback = resolveClaudeBinaryPath({ skipSdkBinary: true })
    expect(fallback).toBeNull()
    if (prev === undefined) delete process.env.SUPERONE_CLAUDE_BINARY
    else process.env.SUPERONE_CLAUDE_BINARY = prev
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('createProductionTurnRunner multi-dispatch', () => {
  it('routes claude harness to Claude Agent SDK runner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prod-claude-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const claudeQueryFn = vi.fn(() =>
      messages([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'm1',
          result: 'hello',
        },
      ]),
    ) as unknown as ClaudeQueryFn

    const runner = createProductionTurnRunner({
      resolveProjectPath: () => dir,
      claudeBinaryPath: bin,
      claudeQueryFn,
      allowSimulatedFallback: false,
    })

    const result = await runner({
      session: session({ harnessId: 'claude' }),
      text: 'hi',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    expect(result.finalText).toBe('hello')
    expect(result.providerResume).toBe('claude-session:m1')
    expect(claudeQueryFn).toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })

  it('routes non-codex/claude to simulated only when fallback allowed', async () => {
    const runner = createProductionTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: true,
    })
    const result = await runner({
      session: session({ harnessId: 'opencode' }),
      text: 'x',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(result.finalText.length).toBeGreaterThan(0)

    const closed = createProductionTurnRunner({
      resolveProjectPath: () => '/tmp',
      allowSimulatedFallback: false,
    })
    await expect(
      closed({
        session: session({ harnessId: 'opencode' }),
        text: 'x',
        onDelta: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not available|not implemented/)
  })
})
