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
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import { shutdownAll as shutdownAllProxies } from '@superone/runtime/llm-proxy'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from '../provider/provider-store'

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
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    ...over,
  }
}

/** Real-SDK-shaped mock: wait for each bridge user message, then emit. */
function bridgeQuery(
  respond: (user: SDKUserMessage, turnIndex: number) => Array<Record<string, unknown>>,
): ClaudeQueryFn {
  return (({ prompt }) =>
    (async function* () {
      let i = 0
      for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
        for (const item of respond(user, i++)) {
          yield item as SDKMessage
        }
      }
    })()) as ClaudeQueryFn
}

function textOf(user: SDKUserMessage): string {
  const c = user.message?.content
  return typeof c === 'string' ? c : JSON.stringify(c)
}

function success(sessionId: string, text: string): Array<Record<string, unknown>> {
  return [
    {
      type: 'stream_event',
      session_id: sessionId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: sessionId,
      result: text,
    },
  ]
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
    const prev = process.env.SUPERONE_CLAUDE_BINARY
    delete process.env.SUPERONE_CLAUDE_BINARY
    try {
      const path = resolveClaudeBinaryPath({ binaryPath: null })
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

    const queryFn = vi.fn(bridgeQuery(() => success('sess-99', 'ok')))

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
    expect(deltas).toEqual([])
    expect(events.some((e) => e.kind === 'text' && e.delta === 'ok')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers the lossless AgentEvent core when the runtime provides it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-agent-events-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    const queryFn = vi.fn(
      bridgeQuery(() => [
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'reason' },
          },
        },
        { type: 'system', subtype: 'task_started', task_id: 'bg1', description: 'work' },
        { type: 'prompt_suggestion', suggestion: 'next' },
        { type: 'result', subtype: 'success', session_id: 'sess-rich', result: 'done' },
      ]),
    )
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

    expect(agentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content_delta',
          messageId: 'assistant-1',
          delta: expect.objectContaining({ type: 'thinking' }),
        }),
        expect.objectContaining({ type: 'task_started', taskId: 'bg1' }),
        expect.objectContaining({ type: 'prompt_suggestion', suggestion: 'next' }),
        expect.objectContaining({ type: 'message_complete', messageId: 'assistant-1' }),
      ]),
    )
    expect(structuredEvents).toEqual([])
    expect(deltas).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  it('forwards turn model to SDK options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-model-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('m1', 'ok')))

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

  it('picks loopback proxy base URL for openai-chat credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-proxy-'))
    const bin = join(dir, 'claude')
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
    providers.setBinding({ consumer: 'chat:claude', credentialId: cred.id })

    const queryFn = vi.fn(bridgeQuery(() => success('proxy-sess', 'ok')))
    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      providers,
      allowSimulatedFallback: false,
    })

    try {
      await runner({
        session: session(),
        text: 'ping',
        onDelta: () => {},
        signal: new AbortController().signal,
      })

      expect(queryFn).toHaveBeenCalled()
      const call = queryFn.mock.calls[0]![0] as { options?: Options }
      const env = call.options?.env as Record<string, string> | undefined
      expect(env?.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(env?.ANTHROPIC_API_KEY).toBe('sk-superone-proxy')
    } finally {
      await runner.disposeAll?.()
      await shutdownAllProxies()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('threads sandboxMode into ClaudeLiveSession / SDK options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-sandbox-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('sb1', 'ok')))

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })

    await runner({
      session: session(),
      text: 'ping',
      sandboxMode: 'auto',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          sandbox: {
            enabled: true,
            autoAllowBashIfSandboxed: true,
            failIfUnavailable: false,
          },
        }),
      }),
    )
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes Host Action SDK MCP into options.mcpServers and keeps it for live session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-'))
    const home = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-home-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('m1', 'ok')))

    const dispose = vi.fn(async () => {})
    const sdkInstance = { type: 'sdk', name: 'superone', instance: { id: 'mcp-1' } }
    let createCount = 0

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      // Isolate from developer ~/.claude.json so merge only sees host-action.
      homeDir: home,
      createHostActionClaudeMcp: (sessionId) => {
        expect(sessionId).toBe('node-sid-42')
        createCount++
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
    // Second turn reuses the long-lived live session + same Host Action MCP.
    await runner({
      session: session({ sessionId: 'node-sid-42' }),
      text: 'again',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    expect(createCount).toBe(1)
    expect(queryFn).toHaveBeenCalledTimes(1)
    const call = queryFn.mock.calls[0]?.[0] as {
      options?: { mcpServers?: unknown; strictMcpConfig?: boolean }
    }
    expect(call?.options?.mcpServers).toEqual({ superone: sdkInstance })
    expect(call?.options?.strictMcpConfig).toBe(true)
    // Dispose only when live process is torn down — not after each turn.
    expect(dispose).not.toHaveBeenCalled()

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('merges enabled project MCP into options.mcpServers with host-action superone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-merge-'))
    const home = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-home-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: { type: 'http', url: 'https://mcp.github.com' },
        },
      }),
    )

    const queryFn = vi.fn(bridgeQuery(() => success('m-merge', 'ok')))
    const sdkInstance = { type: 'sdk', name: 'superone', instance: { id: 'mcp-merge' } }

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      homeDir: home,
      createHostActionClaudeMcp: () => ({
        mcpServers: { superone: sdkInstance as never },
        dispose: async () => {},
      }),
    })

    await runner({
      session: session({ sessionId: 'merge-sid' }),
      text: 'use mcp',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    const call = queryFn.mock.calls[0]?.[0] as {
      options?: { mcpServers?: Record<string, unknown>; strictMcpConfig?: boolean }
    }
    expect(call?.options?.strictMcpConfig).toBe(true)
    expect(call?.options?.mcpServers?.superone).toEqual(sdkInstance)
    expect(call?.options?.mcpServers?.github).toEqual({
      type: 'http',
      url: 'https://mcp.github.com',
    })

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('host-action-only mode skips disk MCP merge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-hao-'))
    const home = mkdtempSync(join(tmpdir(), 'cbr-claude-mcp-hao-home-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: { type: 'http', url: 'https://mcp.github.com' },
        },
      }),
    )

    const queryFn = vi.fn(bridgeQuery(() => success('m-hao', 'ok')))
    const sdkInstance = { type: 'sdk', name: 'superone', instance: {} }

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      homeDir: home,
      mcpMergeMode: 'host-action-only',
      createHostActionClaudeMcp: () => ({
        mcpServers: { superone: sdkInstance as never },
        dispose: async () => {},
      }),
    })

    await runner({
      session: session({ sessionId: 'hao-sid' }),
      text: 'no merge',
      onDelta: () => {},
      signal: new AbortController().signal,
    })

    const call = queryFn.mock.calls[0]?.[0] as {
      options?: { mcpServers?: Record<string, unknown> }
    }
    expect(call?.options?.mcpServers).toEqual({ superone: sdkInstance })
    expect(call?.options?.mcpServers?.github).toBeUndefined()

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('opens live session with resume from providerResume on first turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude3-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('prior-42', 'cont')))

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

  it('disposeSession tears down long-lived live + host-action MCP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-dispose-'))
    const home = mkdtempSync(join(tmpdir(), 'cbr-claude-dispose-home-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const dispose = vi.fn(async () => {})
    const queryFn = vi.fn(bridgeQuery(() => success('live-d', 'ok')))
    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      homeDir: home,
      createHostActionClaudeMcp: () => ({
        mcpServers: { superone: { type: 'sdk', name: 'superone', instance: {} } as never },
        dispose,
      }),
    })

    await runner({
      session: session({ sessionId: 'dispose-s' }),
      text: 'hi',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(dispose).not.toHaveBeenCalled()
    expect(queryFn).toHaveBeenCalledTimes(1)

    await runner.disposeSession?.('dispose-s')
    expect(dispose).toHaveBeenCalledTimes(1)

    // Next turn reopens a fresh live process.
    await runner({
      session: session({ sessionId: 'dispose-s' }),
      text: 'again',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(queryFn).toHaveBeenCalledTimes(2)

    await runner.disposeAll?.()
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('mid-turn inject reuses one SDK query and marks priority next on the second user message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-inject-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const seen: Array<{ text: string; priority?: string }> = []
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const queryFn = vi.fn((({ prompt }) =>
      (async function* () {
        let i = 0
        for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
          const text = textOf(user)
          const priority =
            typeof (user as { priority?: string }).priority === 'string'
              ? (user as { priority?: string }).priority
              : undefined
          seen.push({ text, priority })
          if (i === 0) {
            yield {
              type: 'stream_event',
              session_id: 'live-1',
              event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'one' },
              },
            } as SDKMessage
            await firstGate
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              session_id: 'live-1',
              result: 'one',
            } as SDKMessage
          } else {
            for (const item of success('live-1', 'two')) yield item as SDKMessage
          }
          i++
        }
      })()) as ClaudeQueryFn)

    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
    })

    const firstP = runner({
      session: session({ sessionId: 'inject-s' }),
      text: 'first',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    await new Promise((r) => setTimeout(r, 30))
    const secondP = runner({
      session: session({ sessionId: 'inject-s' }),
      text: 'second',
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    releaseFirst!()
    const [a, b] = await Promise.all([firstP, secondP])

    expect(a.finalText).toBe('one')
    expect(b.finalText).toBe('two')
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([
      { text: 'first', priority: undefined },
      { text: 'second', priority: 'next' },
    ])

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
    if (resolved && resolved.includes('claude-agent-sdk')) {
      expect(resolved).not.toBe(bin)
    } else {
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

    const claudeQueryFn = vi.fn(bridgeQuery(() => success('m1', 'hello')))

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
  it('keeps a root node runnable by relaxing bypassPermissions for the turn', async () => {
    // Reproduces the node failure: Claude Code exits during spawn under uid 0
    // when the turn would skip permission prompts, so no turn ever streamed.
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-root-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('root-sess', 'ok')))
    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      getuid: () => 0,
    })

    const agentEvents: AgentEvent[] = []
    try {
      const result = await runner({
        session: session(),
        text: 'ping',
        permissionMode: 'bypassPermissions',
        onDelta: () => {},
        onAgentEvent: (e) => agentEvents.push(e),
        signal: new AbortController().signal,
      })
      expect(result.finalText).toBe('ok')

      const call = queryFn.mock.calls[0]![0] as { options?: Options }
      expect(call.options?.permissionMode).toBe('acceptEdits')
      expect(call.options?.allowDangerouslySkipPermissions).toBe(false)

      // The desktop selector still says "bypass"; tell it what actually ran.
      expect(agentEvents).toContainEqual(
        expect.objectContaining({
          type: 'agent_setting_change',
          patch: expect.objectContaining({ permissionMode: 'acceptEdits' }),
        }),
      )
    } finally {
      await runner.disposeAll?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves bypassPermissions alone off root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-claude-nonroot-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)

    const queryFn = vi.fn(bridgeQuery(() => success('nonroot-sess', 'ok')))
    const runner = createNodeClaudeTurnRunner({
      binaryPath: bin,
      resolveProjectPath: () => dir,
      queryFn,
      allowSimulatedFallback: false,
      getuid: () => 501,
    })

    const agentEvents: AgentEvent[] = []
    try {
      await runner({
        session: session(),
        text: 'ping',
        permissionMode: 'bypassPermissions',
        onDelta: () => {},
        onAgentEvent: (e) => agentEvents.push(e),
        signal: new AbortController().signal,
      })
      const call = queryFn.mock.calls[0]![0] as { options?: Options }
      expect(call.options?.permissionMode).toBe('bypassPermissions')
      expect(
        agentEvents.some((e) => e.type === 'agent_setting_change'),
      ).toBe(false)
    } finally {
      await runner.disposeAll?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
