import { describe, expect, it } from 'vitest'
import { groupItems } from './popup-groups'

interface Row {
  id: string
  kind: 'a' | 'b' | 'c'
}

const row = (id: string, kind: Row['kind']): Row => ({ id, kind })

describe('groupItems', () => {
  it('reorders mixed items into the declared group order', () => {
    const items = [row('1', 'b'), row('2', 'a'), row('3', 'c'), row('4', 'a')]
    const groups = groupItems(items, (r) => r.kind, ['a', 'b', 'c'])

    expect(groups.map((g) => g.key)).toEqual(['a', 'b', 'c'])
    expect(groups.flatMap((g) => g.items.map((r) => r.id))).toEqual(['2', '4', '1', '3'])
  })

  it('omits groups that have no matching items', () => {
    const items = [row('1', 'a'), row('2', 'c')]
    const groups = groupItems(items, (r) => r.kind, ['a', 'b', 'c'])

    expect(groups.map((g) => g.key)).toEqual(['a', 'c'])
  })

  it('assigns startIndex matching the flat render position so keyboard nav stays aligned', () => {
    const items = [row('1', 'a'), row('2', 'a'), row('3', 'b'), row('4', 'c'), row('5', 'c')]
    const groups = groupItems(items, (r) => r.kind, ['a', 'b', 'c'])

    expect(groups.map((g) => g.startIndex)).toEqual([0, 2, 3])

    const flat = groups.flatMap((g) => g.items)
    for (const g of groups) {
      g.items.forEach((item, j) => {
        expect(flat[g.startIndex + j]).toBe(item)
      })
    }
  })

  it('preserves the original order of items within a group', () => {
    const items = [row('3', 'a'), row('1', 'a'), row('2', 'a')]
    const groups = groupItems(items, (r) => r.kind, ['a'])

    expect(groups[0].items.map((r) => r.id)).toEqual(['3', '1', '2'])
  })

  it('drops items whose key is not in the declared order', () => {
    const items = [row('1', 'a'), { id: '2', kind: 'z' } as unknown as Row]
    const groups = groupItems(items, (r) => r.kind, ['a', 'b', 'c'])

    expect(groups.flatMap((g) => g.items.map((r) => r.id))).toEqual(['1'])
  })
})
