import { describe, expect, it } from 'vitest'
import { LruMap } from './lru-map'

describe('LruMap', () => {
  it('evicts the least recently used entry past its capacity', () => {
    const map = new LruMap<string, number>(2)
    map.set('a', 1).set('b', 2)
    map.get('a')
    map.set('c', 3)
    expect([...map.keys()]).toEqual(['a', 'c'])
  })

  it('evicts by total weight and keeps the weight in step with deletes', () => {
    const map = new LruMap<string, number>(10, { max: 10, weigh: (value) => value })
    map.set('a', 4).set('b', 4)
    map.set('c', 4)
    expect([...map.keys()]).toEqual(['b', 'c'])
    map.delete('b')
    map.set('d', 6)
    expect([...map.keys()]).toEqual(['c', 'd'])
    map.set('c', 1)
    expect([...map.keys()]).toEqual(['d', 'c'])
    map.clear()
    map.set('e', 10)
    expect([...map.keys()]).toEqual(['e'])
  })

  it('does not keep a value heavier than the whole budget', () => {
    const map = new LruMap<string, number>(10, { max: 10, weigh: (value) => value })
    map.set('a', 3).set('huge', 11)
    expect([...map.keys()]).toEqual([])
    map.set('b', 10)
    expect([...map.keys()]).toEqual(['b'])
  })
})
