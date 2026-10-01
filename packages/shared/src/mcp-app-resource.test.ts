import { describe, expect, it, vi } from 'vitest'
import { McpAppResourceCache, mcpAppResourceReadKey, validateMcpAppResource } from './mcp-app-resource'
import type { ToolAppAttachment } from './mcp-apps'

const snapshot = (html = 'one') => ({ html, hash: 'h', meta: {} })
const app: ToolAppAttachment = { appInstanceId: 'a', status: 'result', binding: { node: 'n', session: 's', server: 'CAD', account: 'account', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread', originCallId: 'call' }, resourceUri: 'ui://view' }

describe('bounded MCP App resource cache', () => {
  it('single-flights a miss, returns warm HTML immediately, and refreshes only future reads', async () => {
    const cache = new McpAppResourceCache()
    let complete!: (value: ReturnType<typeof snapshot>) => void
    const read = vi.fn(() => new Promise<ReturnType<typeof snapshot>>(resolve => { complete = resolve }))
    const a = cache.load('key', read), b = cache.load('key', read)
    await Promise.resolve(); expect(read).toHaveBeenCalledOnce()
    complete(snapshot()); expect(await a).toEqual(await b)
    const old = await cache.load('key', read)
    const refresh = cache.refresh('key', async () => snapshot('two'))
    expect(old.html).toBe('one')
    await refresh; expect(cache.get('key')?.html).toBe('two'); expect(old.html).toBe('one')
  })
  it('bounds entries/bytes, keeps recently used entries, and retries failures', async () => {
    const cache = new McpAppResourceCache({ entries: 2, bytes: 100, pending: 2 })
    cache.put('a', snapshot()); cache.put('b', snapshot()); cache.get('a'); cache.put('c', snapshot())
    expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBeTruthy()
    cache.put('large', snapshot('x'.repeat(200))); expect(cache.get('large')).toBeUndefined()
    await expect(cache.load('fail', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await cache.load('fail', async () => snapshot())).toEqual(snapshot())
  })
  it('bounds concurrent cold reads', async () => {
    const cache = new McpAppResourceCache({ entries: 2, bytes: 100, pending: 1 })
    let complete!: (value: ReturnType<typeof snapshot>) => void
    const pending = cache.load('a', () => new Promise(resolve => { complete = resolve }))
    await Promise.resolve()
    await expect(cache.load('b', async () => snapshot())).rejects.toThrow('pending')
    complete(snapshot()); await pending
  })
  it('shares across calls but separates every provider/server/session/config origin', () => {
    const key = mcpAppResourceReadKey(app)
    expect(mcpAppResourceReadKey({ ...app, appInstanceId: 'b', origin: { ...app.origin!, originCallId: 'other' } })).toBe(key)
    for (const field of ['node', 'session', 'server', 'account', 'configGeneration', 'configFingerprint'] as const) expect(mcpAppResourceReadKey({ ...app, binding: { ...app.binding, [field]: 'different' } })).not.toBe(key)
    expect(mcpAppResourceReadKey({ ...app, origin: { providerSessionId: 'other' } })).not.toBe(key)
    expect(mcpAppResourceReadKey({ ...app, resourceUri: 'ui://other' })).not.toBe(key)
  })
  it('accepts thin references and readable legacy inline snapshots; caps HTML independently', () => {
    expect(() => validateMcpAppResource({ hash: 'legacy', meta: {} })).not.toThrow()
    expect(() => validateMcpAppResource(snapshot())).not.toThrow()
    expect(() => validateMcpAppResource(snapshot('x'.repeat(2 * 1024 * 1024 + 1)))).toThrow('size limit')
  })
})
