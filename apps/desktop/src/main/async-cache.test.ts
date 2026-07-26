import { describe, expect, it, vi } from 'vitest'
import { AsyncCoalescer } from './async-cache'

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('concurrent git reads', () => {
  it('runs one computation when every pane asks at the same moment', async () => {
    const coalescer = new AsyncCoalescer<string>()
    const d = deferred<string>()
    const compute = vi.fn(() => d.promise)

    const panes = [1, 2, 3, 4, 5, 6].map(() => coalescer.get('/repo', compute))
    d.resolve('main')

    expect(await Promise.all(panes)).toEqual(Array(6).fill('main'))
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keeps repos independent', async () => {
    const coalescer = new AsyncCoalescer<string>()
    const [a, b] = await Promise.all([
      coalescer.get('/a', async () => 'branch-a'),
      coalescer.get('/b', async () => 'branch-b'),
    ])
    expect([a, b]).toEqual(['branch-a', 'branch-b'])
  })

  it('re-reads after the batch settles, so a refresh right after a checkout is never stale', async () => {
    const coalescer = new AsyncCoalescer<string>()
    const compute = vi.fn().mockResolvedValueOnce('main').mockResolvedValueOnce('feature')

    expect(await coalescer.get('/repo', compute)).toBe('main')
    expect(await coalescer.get('/repo', compute)).toBe('feature')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('serves a cached result inside the TTL and drops it on invalidate', async () => {
    const coalescer = new AsyncCoalescer<string>(1000)
    const compute = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    expect(await coalescer.get('/repo', compute)).toBe('first')
    expect(await coalescer.get('/repo', compute)).toBe('first')
    expect(compute).toHaveBeenCalledTimes(1)

    coalescer.invalidate('/repo')
    expect(await coalescer.get('/repo', compute)).toBe('second')
  })

  it('propagates a failure to every waiter without caching it', async () => {
    const coalescer = new AsyncCoalescer<string>(1000)
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error('git exploded'))
      .mockResolvedValueOnce('recovered')

    const waiters = [coalescer.get('/repo', compute), coalescer.get('/repo', compute)]
    await expect(Promise.all(waiters)).rejects.toThrow('git exploded')

    expect(compute).toHaveBeenCalledTimes(1)
    expect(await coalescer.get('/repo', compute)).toBe('recovered')
  })
})
