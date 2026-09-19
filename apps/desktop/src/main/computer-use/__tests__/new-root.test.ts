import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { parseCondition } from '../conditions'
import { findNode } from '../outline'
import { FakePlatformBackend, type FakeAppSpec } from '../platform/fake-backend'
import { newAppRoots, newRootMatches } from '../new-root'
import type { RootKind } from '../types'

function world(kind: RootKind = 'window'): FakeAppSpec[] {
  return [{ app: 'Editor', bundleId: 'com.test.editor', pid: 7, windows: [{ title: 'Document', windowId: 100, tree: {
    role: 'window', children: [{ role: 'button', name: 'Show Fonts', opensModal: { title: 'Fonts', kind, text: 'Font collection', buttonName: 'Close' } }],
  } }] }]
}

function fixture(kind?: RootKind) {
  const backend = new FakePlatformBackend(world(kind))
  const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
  return { backend, service }
}

describe('native newRoot completion', () => {
  it.each(['window', 'dialog', 'sheet', 'popover'] as const)('follows a new same-app %s and verifies it from the starting snapshot', async (kind) => {
    const { service } = fixture(kind)
    const base = await service.observe(undefined, 'fused')
    const button = base.outline.children![0]
    const acted = await service.act(base.stateId, [{ type: 'press', ref: button.ref }], { delivery: 'semantic' })
    expect(acted.successorRoot).toMatchObject({ title: 'Fonts', kind })
    expect(acted.successorRoot?.rootId).not.toBe(base.root.rootId)
    const result = await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts', text: 'Font collection', rootKind: kind }, 0)
    expect(result).toMatchObject({ status: 'verified', successorRoot: { title: 'Fonts' } })
    const state = service.getStateStore().get(result.successorStateId)!
    expect(state.mode).toBe('fused')
    expect(state.image).toBeDefined()
    expect(findNode(state.outline, state.outline.children![1].ref)?.name).toBe('Close')
  })

  it('shares newRoot with computer_act expect, including native outline text', async () => {
    const { service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    const result = await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![0].ref }], {
      delivery: 'semantic', expect: { kind: 'newRoot', title: 'Fonts', text: 'Font collection' }, timeoutMs: 0,
    })
    expect(result.outcome).toBe('worked')
    expect(result.successorRoot?.title).toBe('Fonts')
  })

  it('does not treat an existing panel, a title change, or another app as a new root', async () => {
    const { backend, service } = fixture()
    const initial = world()
    initial[0].windows.push({ title: 'Fonts', windowId: 200, focused: false, tree: { role: 'window' } })
    backend.reset(initial)
    const root = (await service.listUiRoots()).find((candidate) => candidate.title === 'Document')!
    const base = await service.observe(root.rootId, 'semantic')
    expect((await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts' }, 0)).status).toBe('failed')
    initial[0].windows[0].title = 'Renamed'
    initial.push({ app: 'Other', bundleId: 'com.test.other', pid: 8, windows: [{ title: 'Fonts', windowId: 300, tree: { role: 'window' } }] })
    backend.reset(initial)
    expect((await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts' }, 0)).status).toBe('failed')
    expect((await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Renamed' }, 0)).status).toBe('failed')
  })

  it('requires every supplied title, kind and text filter to match', async () => {
    const { service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![0].ref }], { delivery: 'semantic' })
    expect((await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts', text: 'Missing' }, 0)).status).toBe('failed')
    expect((await service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts', rootKind: 'sheet' }, 0)).status).toBe('failed')
  })

  it('does not match hidden, minimized or secure content', async () => {
    const { service } = fixture()
    const { root } = await service.observe(undefined, 'semantic')
    expect(newAppRoots(root, [], [{ ...root, visible: false }, { ...root, minimized: true }])).toEqual([])
    expect(newRootMatches({ kind: 'newRoot', text: 'secret' }, root, { ref: '@e1', role: 'textField', secure: true, value: 'secret' })).toBe(false)
  })

  it('honors cancellation before discovering or reading a new root', async () => {
    const { service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    const controller = new AbortController()
    controller.abort()
    await expect(service.waitFor(base.stateId, { kind: 'newRoot', title: 'Fonts' }, 1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('validates a concrete match without requiring a future element ref', () => {
    expect(parseCondition({ kind: 'newRoot', title: 'Fonts' })).toEqual({ kind: 'newRoot', title: 'Fonts' })
    expect(() => parseCondition({ kind: 'newRoot' })).toThrow('title or text')
    expect(() => parseCondition({ kind: 'newRoot', title: 'Fonts', rootKind: 'app' })).toThrow('Invalid newRoot')
  })
})
