import { describe, expect, it } from 'vitest'
import { RootRegistry } from '../root-registry'
import type { UiRootIdentity } from '../types'

function root(
  windowId: number | undefined,
  overrides: Partial<Omit<UiRootIdentity, 'rootId'>> = {},
): Omit<UiRootIdentity, 'rootId'> {
  return {
    kind: 'window',
    app: 'Fixture',
    bundleId: 'dev.superone.fixture',
    pid: 42,
    title: 'Untitled',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    focused: false,
    visible: true,
    minimized: false,
    modal: false,
    resourceKey: 'pid:42',
    ...(windowId === undefined ? {} : { windowId }),
    ...overrides,
  }
}

describe('RootRegistry', () => {
  it('keeps same-title windows bound to windowId when scan order changes', () => {
    const registry = new RootRegistry()
    const first = registry.sync([root(101), root(202)])

    const reordered = registry.sync([root(202), root(101)])

    expect(first.map((item) => [item.windowId, item.rootId])).toEqual([
      [101, '@r1'],
      [202, '@r2'],
    ])
    expect(reordered.map((item) => [item.windowId, item.rootId])).toEqual([
      [202, '@r2'],
      [101, '@r1'],
    ])
  })

  it('keeps rootId when a native window title or kind changes', () => {
    const registry = new RootRegistry()
    registry.sync([root(101)])

    const [updated] = registry.sync([
      root(101, { title: 'Save As', kind: 'dialog', modal: true }),
    ])

    expect(updated).toMatchObject({ rootId: '@r1', title: 'Save As', kind: 'dialog' })
  })

  it('does not reuse a rootId after the window disappeared from a scan', () => {
    const registry = new RootRegistry()
    registry.sync([root(101)])
    registry.sync([])

    const [reopened] = registry.sync([root(101)])

    expect(reopened?.rootId).toBe('@r2')
  })

  it('retains the legacy fallback for roots without a windowId', () => {
    const registry = new RootRegistry()
    registry.sync([root(undefined)])

    const [same] = registry.sync([root(undefined)])
    const [renamed] = registry.sync([root(undefined, { title: 'Renamed' })])

    expect(same?.rootId).toBe('@r1')
    expect(renamed?.rootId).toBe('@r2')
  })
})
