import { describe, expect, it, vi } from 'vitest'
import { RequestCoalescer } from './request-coalescer'

describe('read request coalescing', () => {
  it('shares overlapping reads regardless of key order and request id, but expires on settlement', async () => {
    const cache = new RequestCoalescer()
    let resolve!: (value: unknown) => void
    const run = vi.fn(() => new Promise(r => { resolve = r }))
    const first = cache.run({ type: 'get_git_info', projectPath: '/a', requestId: '1' }, 100, run)
    const second = cache.run({ requestId: '2', projectPath: '/a', type: 'get_git_info' }, 100, run)
    expect(second).toBe(first)
    expect(run).toHaveBeenCalledTimes(1)
    resolve({ branch: 'main' })
    await first
    cache.run({ type: 'get_git_info', projectPath: '/a' }, 100, run)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('does not coalesce writes, differing deadlines, hosts or new connection generations', () => {
    const cache = new RequestCoalescer()
    const run = vi.fn(() => new Promise(() => {}))
    cache.run({ type: 'save_draft' }, 100, run)
    cache.run({ type: 'save_draft' }, 100, run)
    cache.run({ type: 'get_git_info' }, 100, run)
    cache.run({ type: 'get_git_info' }, 200, run)
    new RequestCoalescer().run({ type: 'get_git_info' }, 100, run)
    cache.clear()
    cache.run({ type: 'get_git_info' }, 100, run)
    expect(run).toHaveBeenCalledTimes(6)
  })
})
