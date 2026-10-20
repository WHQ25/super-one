import { describe, expect, it, vi } from 'vitest'
import { AsyncCoalescer } from './async-coalescer'

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

  it('does not cache an in-flight result invalidated before it resolves', async () => {
    const coalescer = new AsyncCoalescer<string>(Number.POSITIVE_INFINITY)
    const first = deferred<string>()
    const compute = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('after')

    const stale = coalescer.get('/repo', compute)
    coalescer.invalidate('/repo')
    const fresh = coalescer.get('/repo', compute)
    first.resolve('before')

    expect(await stale).toBe('before')
    expect(await fresh).toBe('after')
    expect(compute).toHaveBeenCalledTimes(2)
    expect(await coalescer.get('/repo', compute)).toBe('after')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('clear drops an in-flight result the same way', async () => {
    const coalescer = new AsyncCoalescer<string>(Number.POSITIVE_INFINITY)
    const first = deferred<string>()
    const compute = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('after')

    const stale = coalescer.get('/repo', compute)
    coalescer.clear()
    const fresh = coalescer.get('/repo', compute)
    first.resolve('before')

    expect(await stale).toBe('before')
    expect(await fresh).toBe('after')
    expect(await coalescer.get('/repo', compute)).toBe('after')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('a forced read does not join an ordinary in-flight read, and two forces share one', async () => {
    const coalescer = new AsyncCoalescer<string>(Number.POSITIVE_INFINITY)
    const ordinary = deferred<string>()
    const forced = deferred<string>()
    const compute = vi.fn()
      .mockImplementationOnce(() => ordinary.promise)
      .mockImplementationOnce(() => forced.promise)

    const first = coalescer.get('/repo', compute)
    const second = coalescer.get('/repo', () => compute(), { force: true })
    const third = coalescer.get('/repo', () => compute(), { force: true })
    ordinary.resolve('plain')
    forced.resolve('forced')

    expect(await first).toBe('plain')
    expect(await second).toBe('forced')
    expect(await third).toBe('forced')
    expect(compute).toHaveBeenCalledTimes(2)
    expect(await coalescer.get('/repo', compute)).toBe('forced')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('uses a per-key ttl and can refuse to cache a value', async () => {
    vi.useFakeTimers()
    try {
      const coalescer = new AsyncCoalescer<string>((key) => key === 'short' ? 1_000 : Number.POSITIVE_INFINITY)
      const compute = vi.fn(async (key: string) => key)
      await coalescer.get('short', () => compute('short'))
      await coalescer.get('long', () => compute('long'))
      await coalescer.get('short', () => compute('short-again'))
      expect(compute).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(1_000)
      expect(await coalescer.get('short', () => compute('short-2'))).toBe('short-2')
      expect(await coalescer.get('long', () => compute('long-again'))).toBe('long')

      const skipped = vi.fn(async () => 'unstable')
      expect(await coalescer.get('skip', skipped, { cacheIf: () => false })).toBe('unstable')
      expect(await coalescer.get('skip', async () => 'stable')).toBe('stable')
      expect(skipped).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remember and invalidateMatching address one key', async () => {
    const coalescer = new AsyncCoalescer<string>(1_000)
    coalescer.remember('a', 'seed')
    coalescer.remember('b', 'other')
    expect(coalescer.peek('a')).toBe('seed')
    const compute = vi.fn(async () => 'fresh')
    expect(await coalescer.get('a', compute)).toBe('seed')
    coalescer.invalidateMatching((key) => key === 'a')
    expect(coalescer.peek('a')).toBeUndefined()
    expect(await coalescer.get('a', compute)).toBe('fresh')
    expect(await coalescer.get('b', compute)).toBe('other')
    expect(compute).toHaveBeenCalledTimes(1)
  })
})
