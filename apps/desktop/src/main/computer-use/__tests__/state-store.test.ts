import { describe, it, expect, beforeEach } from 'vitest'
import { StateStore } from '../state-store'
import type { ComputerUseState, UiOutlineNode, UiRootIdentity } from '../types'

function stubState(id: string, epoch = 0): ComputerUseState {
  const root: UiRootIdentity = {
    rootId: '@r1',
    kind: 'window',
    app: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 1,
    title: 'Notes',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    focused: true,
    visible: true,
    minimized: false,
    modal: false,
    resourceKey: 'pid:1',
  }
  const outline: UiOutlineNode = { ref: '@e1', role: 'window', name: 'Notes' }
  return {
    stateId: id,
    resourceKey: 'pid:1',
    epoch,
    root,
    capturedAt: 0,
    outline,
    coordinateSpace: { width: 100, height: 100, scale: 1, fullScreen: true },
    mode: 'fused',
    capture: 'display',
    nativeLookId: 'n1',
  }
}

describe('StateStore', () => {
  let store: StateStore

  beforeEach(() => {
    store = new StateStore(3)
  })

  it('stores and retrieves immutable states', () => {
    store.put(stubState('S1'))
    expect(store.get('S1')?.stateId).toBe('S1')
    expect(store.has('S1')).toBe(true)
  })

  it('rejects duplicate stateIds', () => {
    store.put(stubState('S1'))
    expect(() => store.put(stubState('S1'))).toThrow(/duplicate/)
  })

  it('evicts oldest when over capacity', () => {
    store.put(stubState('S1'))
    store.put(stubState('S2'))
    store.put(stubState('S3'))
    store.put(stubState('S4'))
    expect(store.has('S1')).toBe(false)
    expect(store.has('S2')).toBe(true)
    expect(store.has('S4')).toBe(true)
    expect(store.size).toBe(3)
    expect(store.ids()).toEqual(['S2', 'S3', 'S4'])
  })

  it('does not mutate stored records on put of others', () => {
    const s1 = stubState('S1')
    store.put(s1)
    store.put(stubState('S2'))
    expect(store.get('S1')).toBe(s1)
  })
})
