import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { TerminalRuntime } from './terminal-runtime'

const resource = { environmentId: 'env', terminalId: 'a' }
const project = { environmentId: 'env', projectId: 'p' }
const tabs = ['a', 'b'].map(terminalId => ({ terminalId, cwd: '/p', title: terminalId === 'a' ? 'shell' : 'vim', status: 'running', ownerDeviceId: null }))
const snapshot = { terminalId: 'a', cwd: '/p', title: 'shell', status: 'running' as const, cols: 80, rows: 24, lastSeq: 1, ownerDeviceId: 'phone', writableByMe: true, subscriberCount: 1 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(ok => { resolve = ok })
  return { promise, resolve }
}
function setup() {
  const rpc = vi.fn(async (method: string, _payload: unknown = {}, _options?: unknown): Promise<unknown> => method === 'terminal.list' ? { terminals: tabs } : { terminalId: 'created', title: 'new' })
  const controlledRpc = vi.fn().mockResolvedValue({ ok: true })
  const acquireControl = vi.fn(async (ref: typeof resource) => ({ resource: ref, leaseId: ref.terminalId, generation: '1' }))
  const releaseControl = vi.fn().mockResolvedValue(undefined)
  const streams: Array<{ close: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; push(event: TerminalEvent): void }> = []
  const followTerminal = vi.fn((ref: typeof resource, emit: (event: TerminalEvent) => void) => {
    const stream = { close: vi.fn().mockResolvedValue(undefined), refresh: vi.fn().mockResolvedValue(undefined), push: emit, ready: Promise.resolve() }
    streams.push(stream)
    emit({ type: 'terminal_snapshot', terminalId: ref.terminalId, snapshot: { ...snapshot, terminalId: ref.terminalId, title: tabs.find(tab => tab.terminalId === ref.terminalId)?.title ?? 'new' }, ansi: '$ ' })
    return stream
  })
  const client = { rpc, controlledRpc, acquireControl, releaseControl, followTerminal, resolveProject: vi.fn().mockResolvedValue(project) }
  const paints = vi.fn()
  const onEmpty = vi.fn()
  const runtime = new TerminalRuntime(client as never, paints, { onEmpty })
  return { runtime, client, streams, paints, onEmpty }
}

describe('native terminal runtime', () => {
  it('opens native project tabs and uses a scoped grant for WebView input and resize', async () => {
    const f = setup()
    await f.runtime.open('/p', 's')
    expect(f.client.rpc).toHaveBeenCalledWith('terminal.list', { projectId: 'p', sessionId: 's' }, { environmentId: 'env' })
    expect(f.runtime.ui).toMatchObject({ activeId: 'a', writable: true, title: 'shell' })
    f.runtime.handleViewMessage(JSON.stringify({ type: 'terminalInput', data: 'ls\r' }))
    f.runtime.handleViewMessage({ type: 'terminalResize', cols: 120, rows: 42 })
    expect(f.client.controlledRpc.mock.calls).toEqual([[resource, 'terminal.write', { data: 'ls\r' }], [resource, 'terminal.resize', { cols: 120, rows: 42 }]])
    f.runtime.dispose()
  })

  it('ignores malformed, oversized and read-only writes', async () => {
    const f = setup()
    await f.runtime.open('/p')
    f.runtime.handleViewMessage('{')
    f.runtime.resize(0, 24)
    f.runtime.resize(80.5, 24)
    f.runtime.input('x'.repeat(65 * 1_024))
    f.streams[0].push({ type: 'terminal_owner_changed', terminalId: 'a', ownerDeviceId: 'other', writableByMe: false })
    f.runtime.input('blocked')
    expect(f.client.controlledRpc).not.toHaveBeenCalled()
    expect(f.client.releaseControl).toHaveBeenCalledWith(resource, { leaseId: 'a', generation: '1' })
    expect(f.runtime.writable).toBe(false)
    f.runtime.dispose()
  })

  it('refreshes the screen after the WebView becomes ready', async () => {
    const f = setup()
    await f.runtime.open('/p')
    f.runtime.handleViewMessage({ type: 'terminalReady' })
    expect(f.streams[0].refresh).toHaveBeenCalledOnce()
    f.runtime.dispose()
  })

  it('does not create a terminal after list failure', async () => {
    const f = setup()
    f.client.rpc.mockRejectedValueOnce(new Error('offline'))
    await f.runtime.open('/p')
    expect(f.client.rpc.mock.calls.map(([method]) => method)).toEqual(['terminal.list'])
    expect(f.paints).toHaveBeenCalledWith([expect.objectContaining({ kind: 'error', message: 'offline' })])
    f.runtime.dispose()
  })

  it('creates only after an authoritative empty list', async () => {
    const f = setup()
    f.client.rpc.mockResolvedValueOnce({ terminals: [] })
    await f.runtime.open('/p', 's')
    expect(f.client.rpc).toHaveBeenCalledWith('terminal.create', { projectId: 'p', sessionId: 's' }, { environmentId: 'env', idempotencyKey: expect.any(String) })
    expect(f.runtime.terminalId).toBe('created')
    f.runtime.dispose()
  })

  it('reuses the create receipt key after a lost response instead of duplicating the PTY', async () => {
    const f = setup()
    f.client.rpc.mockRejectedValueOnce(new Error('response lost'))
    await f.runtime.create('/p')
    f.client.rpc.mockResolvedValueOnce({ terminals: [] })
    await f.runtime.open('/p')
    const creates = f.client.rpc.mock.calls.filter(([method]) => method === 'terminal.create')
    expect(creates).toHaveLength(2)
    expect(creates[0][2]).toEqual(creates[1][2])
    f.runtime.dispose()
  })

  it('closes the old stream and releases its exact grant when switching tabs', async () => {
    const f = setup()
    await f.runtime.open('/p')
    await f.runtime.select('b')
    expect(f.streams[0].close).toHaveBeenCalledOnce()
    expect(f.client.releaseControl).toHaveBeenCalledWith(resource, { leaseId: 'a', generation: '1' })
    f.streams[0].push({ type: 'terminal_output', terminalId: 'a', data: 'stale', fromSeq: 2, toSeq: 2, createdAt: 0 })
    expect(f.runtime.ui).toMatchObject({ activeId: 'b', title: 'vim' })
    expect(f.paints.mock.calls.flat().flat().some(paint => paint.data === 'stale')).toBe(false)
    f.runtime.dispose()
  })

  it('keeps a tab until kill succeeds and keeps it on a refusal', async () => {
    const f = setup()
    await f.runtime.open('/p')
    const pending = deferred<{ ok: boolean }>()
    f.client.controlledRpc.mockReturnValueOnce(pending.promise)
    const closing = f.runtime.closeTab('a')
    expect(f.runtime.tabs.map(tab => tab.terminalId)).toEqual(['a', 'b'])
    pending.resolve({ ok: true })
    await closing
    await vi.waitFor(() => expect(f.runtime.terminalId).toBe('b'))
    f.client.controlledRpc.mockRejectedValueOnce(new Error('lease refused'))
    await f.runtime.closeTab('b')
    expect(f.runtime.tabs.map(tab => tab.terminalId)).toEqual(['b'])
    expect(f.onEmpty).not.toHaveBeenCalled()
    f.runtime.dispose()
  })

  it('uses and releases a temporary exact grant to close an inactive tab', async () => {
    const f = setup()
    await f.runtime.open('/p')
    await f.runtime.closeTab('b')
    expect(f.client.rpc).toHaveBeenCalledWith('terminal.kill', { terminalId: 'b', leaseId: 'b', generation: '1' }, { environmentId: 'env' })
    expect(f.client.releaseControl).toHaveBeenCalledWith({ environmentId: 'env', terminalId: 'b' }, { leaseId: 'b', generation: '1' })
    expect(f.runtime.terminalId).toBe('a')
    f.runtime.dispose()
  })

  it('ignores late acquisition after leaving and releases that grant', async () => {
    const f = setup()
    const pending = deferred<{ resource: typeof resource; leaseId: string; generation: string }>()
    f.client.acquireControl.mockReturnValueOnce(pending.promise)
    const opening = f.runtime.open('/p')
    await vi.waitFor(() => expect(f.client.acquireControl).toHaveBeenCalledOnce())
    f.runtime.dispose()
    pending.resolve({ resource, leaseId: 'late', generation: '2' })
    await opening
    expect(f.client.releaseControl).toHaveBeenCalledWith(resource, { leaseId: 'late', generation: '2' })
    expect(f.client.followTerminal).not.toHaveBeenCalled()
  })

  it('remains readable after denied control and does not reacquire from an ownership push', async () => {
    const f = setup()
    f.client.acquireControl.mockRejectedValueOnce(new Error('already controlled'))
    await f.runtime.open('/p')
    expect(f.client.followTerminal).toHaveBeenCalledOnce()
    expect(f.runtime.writable).toBe(false)
    f.streams[0].push({ type: 'terminal_owner_changed', terminalId: 'a', ownerDeviceId: 'phone', writableByMe: true })
    f.runtime.input('blocked')
    expect(f.client.acquireControl).toHaveBeenCalledOnce()
    expect(f.client.controlledRpc).not.toHaveBeenCalled()
    f.runtime.dispose()
  })

  it('reopens the native list on recovery and releases resources on disposal', async () => {
    const f = setup()
    await f.runtime.open('/p')
    f.runtime.recover()
    await vi.waitFor(() => expect(f.client.followTerminal).toHaveBeenCalledTimes(2))
    f.runtime.dispose()
    expect(f.streams.every(stream => stream.close.mock.calls.length === 1)).toBe(true)
  })

  it('drops other exited tabs and updates active titles', async () => {
    const f = setup()
    await f.runtime.open('/p')
    f.runtime.ingest({ type: 'terminal_exited', terminalId: 'b', exitCode: 0, signal: null })
    f.runtime.ingest({ type: 'terminal_title_changed', terminalId: 'a', title: 'npm run dev' })
    expect(f.runtime.ui).toMatchObject({ title: 'npm run dev', tabs: [{ terminalId: 'a', title: 'npm run dev' }] })
    f.runtime.handleViewMessage({ type: 'terminalTitle', title: 'git status' })
    expect(f.runtime.title).toBe('git status')
    f.runtime.dispose()
  })
})
