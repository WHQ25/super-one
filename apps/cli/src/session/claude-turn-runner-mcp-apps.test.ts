import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeQueryFn } from '@superone/claude'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'
import { createNodeClaudeTurnRunner } from './claude-turn-runner'
import type { NodeSessionRecord } from './session-runtime'

const STATUS = [{
  name: 'fixture',
  status: 'connected',
  tools: [
    { name: 'list', _meta: { ui: { resourceUri: 'ui://fixture/items.html' } } },
    { name: 'next', _meta: { ui: { resourceUri: 'ui://fixture/items.html', visibility: ['app'] } } },
    { name: 'echo', _meta: { ui: { visibility: ['model'] } } },
  ],
}]

function session(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 's1', projectId: 'p1', harnessId: 'claude', providerId: 'claude', title: null, status: 'idle',
    transcript: [], pendingInteraction: null, providerResume: null, cwd: null, createdAt: 0, updatedAt: 0,
    isPinned: false, isHidden: false, isUserRenamed: false, controllerClientSessionId: null,
    hostActionCapabilityVersion: 0, hostActionToolGroups: [], alwaysAllowedTools: [], ...over,
  }
}

/** SDK-shaped query: a bridge-driven message stream plus the control methods MCP Apps use. */
function fakeQuery(turn: Array<Record<string, unknown>>) {
  const request = vi.fn(async () => ({ subtype: 'success', response: { content: '{"page":2}', structuredContent: { page: 2 } } }))
  const queryFn = vi.fn((({ prompt }) => {
    const stream = (async function* () {
      for await (const _user of prompt as AsyncIterable<SDKUserMessage>) {
        for (const message of turn) {
          // Let the catalog refresh a tool_use triggers settle before its result.
          await new Promise((resolve) => setTimeout(resolve, 0))
          yield message as SDKMessage
        }
      }
    })()
    return Object.assign(stream, {
      mcpServerStatus: vi.fn(async () => STATUS),
      readMcpResource: vi.fn(async () => ({ contents: [{ uri: 'ui://fixture/items.html', text: '<html/>' }] })),
      request,
    })
  }) as ClaudeQueryFn)
  return { queryFn, request }
}

const UI_TURN = [
  { type: 'system', subtype: 'init', session_id: 'sess-1' },
  { type: 'assistant', session_id: 'sess-1', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__fixture__list', input: { page: 1 } }] } },
  {
    type: 'user', session_id: 'sess-1', uuid: 'u1',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"page":1}' }] },
    tool_use_result: { content: '{"page":1}', structuredContent: { page: 1 }, _meta: { secret: true } },
  },
  { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', result: 'done' },
]

let dir: string
function runnerWith(queryFn: ClaudeQueryFn) {
  dir = mkdtempSync(join(tmpdir(), 'cbr-claude-apps-'))
  const bin = join(dir, 'claude')
  writeFileSync(bin, '#!/bin/sh\n')
  chmodSync(bin, 0o755)
  return createNodeClaudeTurnRunner({ environmentId: 'node-1', binaryPath: bin, resolveProjectPath: () => dir, queryFn, homeDir: dir, allowSimulatedFallback: false })
}
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const binding: McpAppsBinding = {
  node: 'node-1', session: 's1', server: 'fixture', configGeneration: 0,
  configFingerprint: mcpServerConfigFingerprint(undefined),
}
const origin = { providerSessionId: 'sess-1' }

describe('node Claude MCP Apps', () => {
  it('refuses a held provider when the account changes or its runtime is replaced', async () => {
    const { queryFn, request } = fakeQuery([])
    const runner = runnerWith(queryFn)
    const s = session({ providerResume: 'claude-session:sess-1' })
    const provider = await runner.getMcpAppsProvider!(s, binding, origin)
    s.apiProviderId = 'other'
    await expect(provider.authenticate!({}, new AbortController().signal)).rejects.toMatchObject({ code: 'not_connected' })
    s.apiProviderId = undefined
    await runner.disposeSession?.(s.sessionId)
    await expect(provider.callTool({ tool: 'next', args: {}, origin }, new AbortController().signal)).rejects.toMatchObject({ code: 'inactive' })
    expect(request).not.toHaveBeenCalled()
    await runner.disposeAll?.()
  })

  it('rejects a changed same-name server after idle release reloads project config', async () => {
    const { queryFn, request } = fakeQuery([])
    const runner = runnerWith(queryFn)
    const s = session({ providerResume: 'claude-session:sess-1' })
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'old' } } }))
    const first = await runner.getMcpAppsProvider!(s, { ...binding, configFingerprint: mcpServerConfigFingerprint({ type: 'stdio', command: 'old' }) }, origin)
    first.dispose()
    await runner.disposeSession?.(s.sessionId)
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'new' } } }))
    await expect(runner.getMcpAppsProvider!(s, { ...binding, configFingerprint: mcpServerConfigFingerprint({ type: 'stdio', command: 'old' }) }, origin)).rejects.toMatchObject({ code: 'not_connected' })
    expect(request).not.toHaveBeenCalled()
    await runner.disposeAll?.()
  })

  it('attaches the app to the tool row with a node-scoped binding', async () => {
    const { queryFn } = fakeQuery(UI_TURN)
    const runner = runnerWith(queryFn)
    const events: AgentEvent[] = []
    await runner({ session: session(), text: 'go', onDelta: () => {}, onAgentEvent: (e) => events.push(e), signal: new AbortController().signal })
    const result = events.flatMap((e) => (e.type === 'content_delta' && e.delta.type === 'tool_result' ? [e.delta] : []))[0]
    expect(result?.app).toMatchObject({
      binding: { node: 'node-1', session: 's1', server: 'fixture' },
      origin,
      harnessCallId: 'tu1',
      toolResult: { structuredContent: { page: 1 }, _meta: { secret: true } },
    })
  })

  it('serves app-only calls on the live process and denies model-only tools before mcp_call', async () => {
    const { queryFn, request } = fakeQuery(UI_TURN)
    const runner = runnerWith(queryFn)
    await runner({ session: session(), text: 'go', onDelta: () => {}, signal: new AbortController().signal })
    const s = session({ providerResume: 'claude-session:sess-1' })

    const provider = await runner.getMcpAppsProvider!(s, binding, origin)
    expect(await dispatchMcpAppsProviderRequest({ binding, origin, operation: 'callTool', tool: 'next', args: { page: 2 } }, provider))
      .toMatchObject({ ok: true, value: { outcome: 'completed', result: { structuredContent: { page: 2 } } } })
    expect(request).toHaveBeenCalledWith({ subtype: 'mcp_call', tool: 'mcp__fixture__next', arguments: { page: 2 } }, expect.anything())

    const again = await runner.getMcpAppsProvider!(s, binding, origin)
    expect(await dispatchMcpAppsProviderRequest({ binding, origin, operation: 'callTool', tool: 'echo' }, again))
      .toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(request).toHaveBeenCalledTimes(1)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('opens a first-turn View before the live session identity is persisted', async () => {
    const { queryFn } = fakeQuery(UI_TURN)
    const runner = runnerWith(queryFn)
    const s = session()
    let firstRead: Promise<unknown> | undefined
    await runner({ session: s, text: 'go', onDelta: () => {}, signal: new AbortController().signal,
      onAgentEvent: (event) => {
        if (event.type === 'content_delta' && event.delta.type === 'tool_result' && event.delta.app) {
          firstRead = runner.getMcpAppsProvider!(s, binding, origin).then((provider) =>
            provider.readResource({ uri: 'ui://fixture/items.html', origin }, new AbortController().signal))
        }
      },
    })
    expect(s.providerResume).toBeNull()
    expect(firstRead).toBeDefined()
    await expect(firstRead).resolves.toEqual({ contents: [{ uri: 'ui://fixture/items.html', text: '<html/>' }] })
    // A durable identity must not allow a View from a different live process.
    await expect(runner.getMcpAppsProvider!(session({ providerResume: 'claude-session:other' }), binding, { providerSessionId: 'other' }))
      .rejects.toMatchObject({ code: 'inactive' })
    expect(queryFn).toHaveBeenCalledTimes(1)
    await runner.disposeAll?.()
  })

  it('reopens a released process from the session record for a restored View', async () => {
    const { queryFn, request } = fakeQuery([])
    const runner = runnerWith(queryFn)
    const provider = await runner.getMcpAppsProvider!(session({ providerResume: 'claude-session:sess-1' }), binding, origin)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(queryFn.mock.calls[0]![0].options?.resume).toBe('sess-1')
    expect(await provider.readResource({ uri: 'ui://fixture/items.html', origin }, new AbortController().signal))
      .toEqual({ contents: [{ uri: 'ui://fixture/items.html', text: '<html/>' }] })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects another Claude session, a changed account and a relocated server', async () => {
    const { queryFn } = fakeQuery([])
    const runner = runnerWith(queryFn)
    const s = session({ providerResume: 'claude-session:sess-1' })
    await expect(runner.getMcpAppsProvider!(session(), binding, origin)).rejects.toMatchObject({ code: 'inactive' })
    await expect(runner.getMcpAppsProvider!(s, binding, { providerSessionId: 'other' })).rejects.toMatchObject({ code: 'inactive' })
    await expect(runner.getMcpAppsProvider!(session({ providerResume: 'claude-session:sess-1', apiProviderId: 'p2' }), binding, origin))
      .rejects.toMatchObject({ code: 'not_connected' })
    await expect(runner.getMcpAppsProvider!(s, { ...binding, configFingerprint: 'elsewhere' }, origin)).rejects.toMatchObject({ code: 'not_connected' })
  })
})
