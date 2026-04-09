import { describe, it, expect } from 'vitest'
import { groupItems } from './MiniAppOverlayPortal'
import type { MiniAppContextMenuItem } from '../../../../shared/miniapp-types'

describe('groupItems', () => {
  it('returns single group for items without separators or groups', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]
    const groups = groupItems(items)
    expect(groups).toEqual([
      { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    ])
  })

  it('splits groups on separator items', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'a', label: 'A' },
      { id: 'sep', label: '', separator: true },
      { id: 'b', label: 'B' },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].items).toEqual([{ id: 'a', label: 'A' }])
    expect(groups[1].items).toEqual([{ id: 'b', label: 'B' }])
  })

  it('assigns group labels from group field', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'a', label: 'A', group: 'First' },
      { id: 'b', label: 'B', group: 'First' },
      { id: 'c', label: 'C', group: 'Second' },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({ label: 'First', items: [items[0], items[1]] })
    expect(groups[1]).toEqual({ label: 'Second', items: [items[2]] })
  })

  it('handles separator + group together', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'edit', label: 'Edit', group: 'Actions' },
      { id: 'copy', label: 'Copy', group: 'Actions' },
      { id: 'sep', label: '', separator: true },
      { id: 'share', label: 'Share', group: 'More' },
      { id: 'sep2', label: '', separator: true },
      { id: 'delete', label: 'Delete', variant: 'destructive' },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(3)
    expect(groups[0].label).toBe('Actions')
    expect(groups[0].items).toHaveLength(2)
    expect(groups[1].label).toBe('More')
    expect(groups[1].items).toHaveLength(1)
    expect(groups[2].label).toBeUndefined()
    expect(groups[2].items).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(groupItems([])).toEqual([])
  })

  it('ignores leading separator', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'sep', label: '', separator: true },
      { id: 'a', label: 'A' },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toEqual([{ id: 'a', label: 'A' }])
  })

  it('ignores trailing separator', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'a', label: 'A' },
      { id: 'sep', label: '', separator: true },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(1)
  })

  it('ignores consecutive separators', () => {
    const items: MiniAppContextMenuItem[] = [
      { id: 'a', label: 'A' },
      { id: 'sep1', label: '', separator: true },
      { id: 'sep2', label: '', separator: true },
      { id: 'b', label: 'B' },
    ]
    const groups = groupItems(items)
    expect(groups).toHaveLength(2)
  })
})
