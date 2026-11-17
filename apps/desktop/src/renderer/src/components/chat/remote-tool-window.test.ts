// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { fragmentMessage, MAX_FRAGMENT_BYTES } from '@superone/shared/transcript-window/fragment-message'
import { textMessage } from '@superone/shared/transcript-window/window-fixtures'
import { materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { bodyVersion, inlineBodyAddress, TOOL_CHUNK_CHARS, type ToolChunkRequest } from '@superone/shared/transcript-window/tool-body'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import { DetailViews } from '@superone/runtime/stream/delivery/projection'
import { handleSessionSubscribeDetail } from '@superone/runtime/server/rpc-session-reads'
import type { DetailTarget, DetailUpdate } from '@superone/shared/environment/detail'
import { desktopDetailClient } from '@/lib/desktop-detail-client'
import { handleSessionToolChunk } from '@superone/runtime/server/rpc-session-tool-chunk'
import type { RpcContext } from '@superone/runtime/server/rpc-context'
import { useChatStore, createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat'
import { forEachAgentEventPayload } from '../../../../preload/agent-event-payload'
import { ToolBodyCache } from '@/lib/tool-body-cache'
import { useRemoteToolMessages } from './use-remote-tool-messages'

const source = JSON.stringify({ title: 'chart', widget_code: '<p>' + '图😀'.repeat(24_000) + '</p>' })
const message: ChatMessage = { ...textMessage('m', 'assistant', ''), content: [
  { type: 'tool_use', toolName: 'mcp__superone__widget_show', toolUseId: 'w', input: source },
  { type: 'tool_result', toolUseId: 'w', summary: 'Widget shown' },
] }
const context = { client: { scopes: ['session:read'] }, sessions: { messages: () => [message] } } as unknown as RpcContext
function snapshot(row = message) {
  const fragments = fragmentMessage(projectWindowMessage(row))
  return materializeWindowMessage({ ...fragments, omittedBefore: 0, omittedAfter: 0, index: 0 })
}
async function read(_connection: string, request: ToolChunkRequest) {
  const reply = await handleSessionToolChunk(request, context)
  if (reply.error) throw new Error(reply.error.message)
  return reply.result as string
}

describe('large widgets in a remote session', () => {
  it('recovers an existing widget over bounded reads, and reuses it after restarting the client', async () => {
    const window = snapshot()
    const notice = window.content[0]
    if (notice.type !== 'notice' || !notice.toolBody) throw Error('missing widget reference')
    expect(JSON.stringify(notice)).not.toContain('图')
    const get = vi.fn(read)
    const saved = new Map<string, string>()
    const disk = { read: async (k: string) => saved.get(k), write: async (k: string, v: string) => { saved.set(k, v) } }
    const client = new ToolBodyCache(get, disk)
    const load = (cache: ToolBodyCache) => cache.load('node', 'session', inlineBodyAddress('m', notice.toolBody!))
    const [a, b] = await Promise.all([load(client), load(client)])
    expect(a).toBe(source)
    expect(b).toBe(source)
    expect(get.mock.calls.map(([, request]) => request.offset)).toEqual(
      Array.from({ length: Math.ceil(source.length / TOOL_CHUNK_CHARS) }, (_, i) => i * TOOL_CHUNK_CHARS),
    )
    for (const call of get.mock.results) expect(new TextEncoder().encode(JSON.stringify(await call.value)).length).toBeLessThan(MAX_FRAGMENT_BYTES)
    get.mockClear()
    expect(await load(new ToolBodyCache(get, disk))).toBe(source)
    expect(get).not.toHaveBeenCalled()
    expect(await handleSessionToolChunk({ sessionId: 'session', messageId: 'm', toolUseId: 'w', type: 'tool_use', offset: 0, digest: 'old' }, context))
      .toMatchObject({ error: { code: 'failed_precondition' } })
  })

  it('discards interrupted reads and replaces a corrupt disk copy only after a complete retry', async () => {
    const notice = snapshot().content[0]
    if (notice.type !== 'notice' || !notice.toolBody) throw Error('missing widget reference')
    const disk = { read: async () => 'x'.repeat(source.length), write: vi.fn(async () => {}) }
    let interrupted = true
    const cache = new ToolBodyCache(async (connection, request) => {
      if (interrupted && request.offset > 0) return ''
      return read(connection, request)
    }, disk)
    await expect(cache.load('node', 's', inlineBodyAddress('m', notice.toolBody))).rejects.toThrow('Incomplete')
    expect(disk.write).not.toHaveBeenCalled()
    interrupted = false
    expect(await cache.load('node', 's', inlineBodyAddress('m', notice.toolBody))).toBe(source)
    expect(disk.write).toHaveBeenCalledOnce()
  })

  it.each(['normal', 'over memory budget'])('uses full widget events in the same IPC batch (%s)', async size => {
    const input = size === 'normal' ? source : JSON.stringify({ widget_code: 'x'.repeat(4 * 1024 * 1024) })
    const call = { type: 'tool_use', toolName: 'mcp__superone__widget_show', toolUseId: 'w', input, status: 'complete' } as const
    const widget = { ...message, content: [call, message.content[1]] }
    const projectPath = 'remote:node:/repo'
    const sessionId = 'same-batch-' + size
    const project = createDefaultProjectState()
    project._activeSessionId = sessionId
    project._sessions[sessionId] = { ...createDefaultPerSessionState(), messages: [] }
    const before = useChatStore.getState()
    useChatStore.setState({ projectSessions: { [projectPath]: project }, activeProject: projectPath })
    const environment = window.environment
    const get = vi.fn(read)
    Object.defineProperty(window, 'environment', { value: { ...environment, readToolChunk: get }, configurable: true })
    try {
      const batch: AgentEvent[] = [
        { type: 'content_delta', projectPath, sessionId, messageId: message.id, delta: call },
        { type: 'transcript_window', projectPath, sessionId, rows: [snapshot(widget)], patch: { messages: [], total: 1 } },
      ]
      forEachAgentEventPayload(batch, useChatStore.getState().handleAgentEvent)
      const rows = useChatStore.getState().projectSessions[projectPath]._sessions[sessionId].messages
      const restored = rows[0]?.content[0]
      expect(restored?.type === 'tool_use' && restored.input === input).toBe(true)
      const { result } = renderHook(() => useRemoteToolMessages(rows, 'node', sessionId))
      expect(result.current[0]).toBe(rows[0])
      expect(get).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'environment', { value: environment, configurable: true })
      useChatStore.setState(before, true)
    }
  })

  it('matches the received version and scope before reusing a body', async () => {
    const readChunk = vi.fn(async () => 'from node')
    const cache = new ToolBodyCache(readChunk, { read: async () => undefined, write: async () => {} })
    const call = { type: 'tool_use', toolUseId: 'call', toolName: 'custom', input: '{}' } as const
    const live = { type: 'tool_result', toolUseId: 'call', summary: 'version A' } as const
    const row: ChatMessage = { ...message, content: [
      { type: 'tool_result', toolUseId: 'call', summary: 'preview', remoteBody: bodyVersion(live.summary) },
    ] }
    cache.receiveBlock('node', 's', row.id, live)
    cache.receiveBlock('node', 's', row.id, { ...live, summary: 'version B' })
    cache.receiveBlock('node', 's', row.id, call)
    expect(cache.reuseReceived('other-node', 's', row)).toBe(row)
    expect(cache.reuseReceived('node', 'other-session', row)).toBe(row)
    expect(cache.reuseReceived('node', 's', { ...row, id: 'other-message' }).content).toBe(row.content)
    expect(cache.reuseReceived('node', 's', row).content[0]).toEqual(live)
    const missing: ChatMessage = { ...row, content: [{ ...live, summary: 'preview', remoteBody: bodyVersion('from node') }] }
    expect(cache.reuseReceived('node', 's', missing)).toBe(missing)
    expect(await cache.load('node', 's', { messageId: row.id, toolUseId: 'call', type: 'tool_result', ...bodyVersion('from node') })).toBe('from node')
    expect(readChunk).toHaveBeenCalledOnce()
  })

  it('reuses the completed live call when switching back to that session', async () => {
    const get = vi.fn(read)
    const environment = window.environment
    Object.defineProperty(window, 'environment', { value: { ...environment, readToolChunk: get }, configurable: true })
    try {
      const { result, rerender } = renderHook(({ rows, session }) => useRemoteToolMessages(rows, 'node', session),
        { initialProps: { rows: [message], session: 'live' } })
      rerender({ rows: [], session: 'elsewhere' })
      rerender({ rows: [snapshot()], session: 'live' })
      await waitFor(() => expect(result.current[0].content[0]).toMatchObject({ type: 'tool_use', input: source }))
      expect(get).not.toHaveBeenCalled()
      rerender({ rows: [snapshot()], session: 'cold' })
      await waitFor(() => expect(result.current[0].content[0]).toMatchObject({ type: 'tool_use', input: source }))
      expect(get.mock.calls.length).toBeGreaterThan(1)
    } finally { Object.defineProperty(window, 'environment', { value: environment, configurable: true }) }
  })

  it('addresses large template results and preserves an unrelated compact result', () => {
    const [call, result] = message.content
    if (call.type !== 'tool_use' || result.type !== 'tool_result') throw Error()
    const row = snapshot({ ...message, content: [
      { ...call, input: '{"template":"saved-chart"}' }, { ...result, summary: source },
      { ...result, toolUseId: 'other', summary: source },
    ] })
    expect(row.content[1]).toMatchObject({ kind: 'omitted', toolBody: { head: { type: 'tool_result', toolUseId: 'w', summary: '' } } })
    expect(row.content[2]).toMatchObject({ type: 'tool_result', remoteBody: { length: source.length } })
  })
})

describe('large remote tool results', () => {
  const output = '一行😀\0\n'.repeat(6000)
  function bash(summary: string): ChatMessage {
    return { ...message, content: [
      { type: 'tool_use', toolName: 'Bash', toolUseId: 'cmd', input: '{"command":"ls"}' },
      { type: 'tool_result', toolUseId: 'cmd', summary, exitCode: 7 },
    ] }
  }

  it('leaves a collapsed command lazy, reuses live output, and applies updates arriving during a cold read', async () => {
    let row = bash(output)
    const views = new DetailViews()
    const ctx = { client: { scopes: ['session:read'] }, sessions: { detailMessage: () => row }, streams: { delivery: { views } } } as unknown as RpcContext
    const initial = snapshot(row)
    const detailRef = initial.content[0].remoteDetail!
    expect(detailRef).toBeTruthy()
    const subscribe = vi.fn(async (target: DetailTarget, subscriptionId: string) => {
      const reply = handleSessionSubscribeDetail({ ...target, subscriptionId, chunkedSnapshot: true }, ctx)
      if (reply.error) throw Error(reply.error.message)
      expect(new TextEncoder().encode(JSON.stringify(reply.result)).length).toBeLessThan(MAX_FRAGMENT_BYTES)
      return reply.result as DetailUpdate
    })
    let changeOnRead = false
    const readToolChunk = vi.fn(async (_: string, request: ToolChunkRequest) => {
      if (changeOnRead) {
        changeOnRead = false
        row = bash('updated ' + output)
        const packets = views.updates(request.sessionId, [row])
        expect(packets.length).toBeGreaterThan(1)
        for (const packet of packets) {
          expect(new TextEncoder().encode(JSON.stringify(packet)).length).toBeLessThan(MAX_FRAGMENT_BYTES)
          if (packet.type === 'remote_detail') desktopDetailClient.deliver(packet)
        }
        views.open(request.sessionId, true) // paging history while the detail is expanding
      }
      const reply = await handleSessionToolChunk(request, ctx)
      if (reply.error) throw Error(reply.error.message)
      return reply.result as string
    })
    const env = window.environment
    Object.defineProperty(window, 'environment', { configurable: true, value: {
      readToolChunk, subscribeDetail: subscribe,
      unsubscribeDetail: (target: DetailTarget, id: string) => views.unsubscribe(target.sessionId, id),
    } })
    async function expand(sessionId: string) {
      views.open(sessionId, true)
      let text = ''
      let close = () => {}
      await new Promise<void>((resolve, reject) => {
        close = desktopDetailClient.open([{ environmentId: 'node', sessionId, detailRef }], {
          complete: false, onText: value => { text = value }, onError: reject, onSettled: resolve,
        })
      })
      close()
      return JSON.parse(text)
    }
    try {
      const { rerender } = renderHook(({ rows, session }) => useRemoteToolMessages(rows, 'node', session),
        { initialProps: { rows: [row], session: 'command-live' } })
      rerender({ rows: [initial], session: 'command-cold' })
      expect(subscribe).not.toHaveBeenCalled()
      expect(readToolChunk).not.toHaveBeenCalled()

      expect(await expand('command-live')).toMatchObject({ result: output, exitCode: 7 })
      expect(readToolChunk).not.toHaveBeenCalled()

      changeOnRead = true
      expect(await expand('command-cold')).toMatchObject({ result: 'updated ' + output, exitCode: 7 })
      expect(readToolChunk.mock.calls.length).toBe(Math.ceil(output.length / TOOL_CHUNK_CHARS))
      readToolChunk.mockClear()
      expect(await expand('command-cold')).toMatchObject({ result: 'updated ' + output })
      expect(readToolChunk).not.toHaveBeenCalled()

      row = bash('changed ' + output)
      expect(await expand('command-cold')).toMatchObject({ result: 'changed ' + output })
      expect(readToolChunk).toHaveBeenCalled()
    } finally { Object.defineProperty(window, 'environment', { configurable: true, value: env }) }
  })

  it.each([false, true])('restores an inline media result from its compact representation (large metadata %s)', async largeHead => {
    const row: ChatMessage = { ...message, content: [
      { type: 'tool_use', toolName: 'mcp__superone__media_generate_image', toolUseId: 'media', input: '{}' },
      { type: 'tool_result', toolUseId: 'media', summary: output,
        ...(largeHead ? { resultTitle: 'T'.repeat(40000) } : {}) },
    ] }
    const shell = snapshot(row)
    const lookup = vi.fn(() => row)
    const ctx = { client: { scopes: ['session:read'] }, streams: { delivery: {} }, sessions: { detailMessage: lookup } } as unknown as RpcContext
    expect(shell.content[1]).toMatchObject(largeHead ? { toolBody: { wholeBlock: true } } : { remoteBody: { length: output.length } })
    const readToolChunk = vi.fn(async (_: string, request: ToolChunkRequest) => {
      const reply = await handleSessionToolChunk(request, ctx)
      if (reply.error) throw Error(reply.error.message)
      return reply.result
    })
    const env = window.environment
    Object.defineProperty(window, 'environment', { configurable: true, value: { readToolChunk } })
    try {
      const session = 'inline-' + largeHead
      const { result, rerender } = renderHook(({ rows }) => useRemoteToolMessages(rows, 'node', session), { initialProps: { rows: [shell] } })
      await waitFor(() => expect(result.current[0].content[1]).toEqual(row.content[1]))
      expect(readToolChunk.mock.calls.length).toBeGreaterThan(1)
      expect(lookup).toHaveBeenCalledTimes(largeHead ? 2 : 1)
      readToolChunk.mockClear()
      rerender({ rows: [snapshot(row)] })
      await waitFor(() => expect(result.current[0].content[1]).toEqual(row.content[1]))
      expect(readToolChunk).not.toHaveBeenCalled()
    } finally { Object.defineProperty(window, 'environment', { configurable: true, value: env }) }
  })
})
