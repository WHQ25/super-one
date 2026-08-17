import { describe, expect, it } from 'vitest'
import { toNativeMenu, type AdaptiveMenuEntry } from './native-context-menu'

describe('toNativeMenu', () => {
  it('converts a submenu into a native submenu spec', () => {
    const entries: AdaptiveMenuEntry[] = [
      {
        kind: 'submenu',
        id: 'tags',
        label: 'Tags',
        items: [
          { kind: 'item', id: 'tag:ui', label: 'ui', disabled: true, onSelect: () => undefined },
        ],
      },
    ]
    expect(toNativeMenu(entries)).toEqual([
      {
        id: 'tags',
        label: 'Tags',
        type: 'submenu',
        icon: undefined,
        submenu: [
          { id: 'tag:ui', label: 'ui', icon: undefined, enabled: false, onSelect: expect.any(Function) },
        ],
      },
    ])
  })
})
