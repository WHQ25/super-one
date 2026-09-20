import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { FakePlatformBackend, type FakeAppSpec } from '../platform/fake-backend'

/** A window with a button whose press opens a context menu holding one item. */
function world(): FakeAppSpec[] {
  return [{ app: 'Editor', bundleId: 'com.test.editor', pid: 7, windows: [{ title: 'Document', windowId: 100, tree: {
    role: 'window', children: [{ role: 'button', name: 'More', opensModal: { title: 'Context', kind: 'menu', text: 'Actions', buttonName: 'Rename' } }],
  } }] }]
}

function fixture() {
  const backend = new FakePlatformBackend(world())
  const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
  return { backend, service }
}

async function openMenu(service: ComputerUseService) {
  const base = await service.observe(undefined, 'semantic')
  const acted = await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![0].ref }])
  expect(acted.successorRoot).toMatchObject({ title: 'Context', kind: 'menu' })
  return { base, acted }
}

describe('context menus are read and dismissed', () => {
  it('takes a menu an action opened down once the successor has read it', async () => {
    const { backend, service } = fixture()
    const { acted } = await openMenu(service)
    expect(backend.dismissals).toEqual(['Context'])
    // The state still carries the menu's items; the screen no longer shows the menu.
    const state = service.getStateStore().get(acted.successorStateId)!
    expect(state.outline.children!.map((node) => node.name)).toEqual(['Actions', 'Rename'])
    expect((await service.listUiRoots()).map((root) => root.title)).toEqual(['Document'])
  })

  it('reopens the menu to act on its state, under the same rootId, and takes it down again', async () => {
    const { backend, service } = fixture()
    const { acted } = await openMenu(service)
    const menuState = service.getStateStore().get(acted.successorStateId)!
    const item = menuState.outline.children!.find((node) => node.name === 'Rename')!
    // The reopened menu has a new helper identity; the act's geometry must
    // name it, not the one the state was captured with (that menu is gone,
    // and the helper rejects input validated against it).
    const seen: Array<string | undefined> = []
    const act = backend.act.bind(backend)
    backend.act = async (req) => { seen.push(req.coordinateSpace?.axRootId); return act(req) }
    const pressed = await service.act(acted.successorStateId, [{ type: 'press', ref: item.ref }])
    expect(pressed.outcome).not.toBe('didnt')
    expect(pressed.evidence.map((step) => step.description)).toEqual(['activate(Rename)'])
    expect(menuState.coordinateSpace.axRootId).toBeDefined()
    expect(seen.at(-1)).toBe(pressed.successorRoot?.axRootId ?? seen.at(-1))
    expect(seen.at(-1)).not.toBe(menuState.coordinateSpace.axRootId)
    // Reopened for the press (one more "More" press in the fake), then dismissed again.
    expect(backend.dismissals).toEqual(['Context', 'Context'])
    expect((await service.listUiRoots()).map((root) => root.title)).toEqual(['Document'])
    expect(pressed.successorRoot?.rootId).toBe(acted.successorRoot!.rootId)
  })

  it('reopens the menu for a snapshot of it and for a newRoot wait already on it', async () => {
    const { backend, service } = fixture()
    const { acted } = await openMenu(service)
    const again = await service.observe(acted.successorRoot!.rootId, 'semantic')
    expect(again.root.rootId).toBe(acted.successorRoot!.rootId)
    expect(again.outline.children!.map((node) => node.name)).toEqual(['Actions', 'Rename'])
    expect(backend.dismissals).toEqual(['Context', 'Context'])
    const wait = await service.waitFor(acted.successorStateId, { kind: 'newRoot', rootKind: 'menu', text: 'Actions' }, 0)
    expect(wait).toMatchObject({ status: 'preexisting', successorRoot: { title: 'Context' } })
    expect(backend.dismissals).toEqual(['Context', 'Context', 'Context'])
  })

  it('leaves a menu alone that was already up before the action', async () => {
    const { backend, service } = fixture()
    const { acted } = await openMenu(service)
    // Bring it up outside the service, as the user would.
    const state = service.getStateStore().get(acted.successorStateId)!
    backend.dismissals.length = 0
    const specs = world()
    specs[0]!.windows.push({ title: 'Context', kind: 'menu', tree: { role: 'menu', name: 'Context', children: [{ role: 'menuItem', name: 'Rename' }] } })
    backend.reset(specs)
    const doc = (await service.listUiRoots()).find((root) => root.title === 'Document')!
    const base = await service.observe(doc.rootId, 'semantic')
    await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![0].ref }])
    expect(backend.dismissals).toEqual([])
    void state
  })

  it('reports the state stale when the menu cannot be brought back', async () => {
    const { backend, service } = fixture()
    const { acted } = await openMenu(service)
    const menuState = service.getStateStore().get(acted.successorStateId)!
    const item = menuState.outline.children!.find((node) => node.name === 'Rename')!
    // The opener's button is gone: nothing replays.
    backend.reset([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7, windows: [{ title: 'Document', windowId: 100, tree: { role: 'window' } }] }])
    await expect(service.act(acted.successorStateId, [{ type: 'press', ref: item.ref }])).rejects.toMatchObject({ code: 'STALE_STATE' })
  })
})
