import { describe, expect, it, vi } from 'vitest'
import { MAX_CACHED_ICONS, MENTION_ICON_CACHE_KEY, MentionIconCache } from './mention-icon-cache'

function fakeStore(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(MENTION_ICON_CACHE_KEY, initial)
  return {
    values,
    writes: 0,
    store: {
      get: async (key: string) => values.get(key) ?? null,
      set: async function (this: void, key: string, value: string) { values.set(key, value) },
    },
  }
}

describe('MentionIconCache', () => {
  it('asks only for ids it has never seen', async () => {
    const { store } = fakeStore(JSON.stringify({ a: 'AAA' }))
    const cache = new MentionIconCache(store)
    await cache.load()
    expect(cache.missing(['a', 'b', 'c'])).toEqual(['b', 'c'])
  })

  it('asks for a repeated id once', async () => {
    // Two rows can share an icon — a mini-app and the app it wraps.
    const cache = new MentionIconCache(fakeStore().store)
    await cache.load()
    expect(cache.missing(['b', 'b', 'b'])).toEqual(['b'])
  })

  it('survives a restart, because ids are content hashes', async () => {
    const backing = fakeStore()
    const first = new MentionIconCache(backing.store)
    await first.load()
    first.put({ a: 'AAA' })
    await first.flush()

    const second = new MentionIconCache(backing.store)
    await second.load()
    expect(second.get('a')).toBe('AAA')
    expect(second.missing(['a'])).toEqual([])
  })

  it('reports whether anything was actually added, so the rows repaint once', async () => {
    const cache = new MentionIconCache(fakeStore().store)
    await cache.load()
    expect(cache.put({ a: 'AAA' })).toBe(true)
    expect(cache.put({ a: 'AAA' })).toBe(false)
    expect(cache.put({})).toBe(false)
  })

  it('drops the oldest icons rather than growing without bound', async () => {
    const cache = new MentionIconCache(fakeStore().store)
    await cache.load()
    const many: Record<string, string> = {}
    for (let i = 0; i < MAX_CACHED_ICONS + 10; i++) many[`icon-${i}`] = 'PNG'
    cache.put(many)
    expect(cache.get('icon-0')).toBeUndefined()
    expect(cache.get(`icon-${MAX_CACHED_ICONS + 9}`)).toBe('PNG')
  })

  it('coalesces a burst of misses into one write', async () => {
    vi.useFakeTimers()
    try {
      const backing = fakeStore()
      const set = vi.fn(async (key: string, value: string) => { backing.values.set(key, value) })
      const cache = new MentionIconCache({ get: backing.store.get, set })
      await cache.load()
      cache.put({ a: 'A' })
      cache.put({ b: 'B' })
      cache.put({ c: 'C' })
      expect(set).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(set).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a corrupt cache as an empty one instead of failing the search', async () => {
    const cache = new MentionIconCache(fakeStore('not json at all').store)
    await cache.load()
    expect(cache.missing(['a'])).toEqual(['a'])
  })

  it('treats an unreadable store the same way', async () => {
    const cache = new MentionIconCache({
      get: async () => { throw new Error('keychain locked') },
      set: async () => {},
    })
    await cache.load()
    expect(cache.get('a')).toBeUndefined()
  })
})
