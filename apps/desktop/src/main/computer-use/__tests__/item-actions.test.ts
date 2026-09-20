import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { FakePlatformBackend, type FakeElementSpec } from '../platform/fake-backend'
import { parseActions } from '../actions'
import { axTreeToOutline } from '../platform/ax-outline'
import { MacosPlatformAdapter } from '../platform/macos-adapter'
import { planNodeAction } from '../node-action-plan'
import { createComputerAdapter } from '../../jev/computer-page'
import { outlineToRows } from '../outline-toon'

function fixture() {
  const utilities: FakeElementSpec = { role: 'window', children: [
    { role: 'image', name: 'Console', selectable: true, openable: true, itemKind: 'file' },
    { role: 'image', name: 'Unknown', openable: true },
  ] }
  const applications: FakeElementSpec = { role: 'window', children: [
    { role: 'image', name: 'Utilities', selectable: true, openable: true, itemKind: 'folder', openView: { title: 'Utilities', tree: utilities } },
  ] }
  const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'Home', windowId: 100, tree: {
    role: 'window', children: [{ role: 'row', name: 'App Store icon', value: 'Applications', selectable: true, selectView: { title: 'Applications', tree: applications } }],
  } }] }])
  const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
  service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
  return { service }
}

describe('native item selection and opening', () => {
  it('parses ref-only actions and preserves native capability evidence', () => {
    expect(parseActions([{ type: 'select', ref: '@e2' }, { type: 'open', ref: '@e3' }])).toEqual([{ type: 'select', ref: '@e2' }, { type: 'open', ref: '@e3' }])
    expect(() => parseActions([{ type: 'open' }])).toThrow('ref')
    const node = axTreeToOutline({ index: 2, role: 'AXImage', selectable: true, selected: true, actions: ['AXOpen'], itemKind: 'folder' })
    expect(node).toMatchObject({ selected: true, itemKind: 'folder', capabilities: { select: true, open: true, press: false } })
    expect(outlineToRows(node)[0]).toMatchObject({ can: 'select|open', state: 'selected|folder' })
    expect(planNodeAction(node, { kind: 'open' }, 'read')).toBeUndefined()
    expect(planNodeAction({ ...node, secure: true }, { kind: 'select' }, 'full')).toBeUndefined()
    expect(planNodeAction({ ...node, enabled: false }, { kind: 'open' }, 'full')).toBeUndefined()
    expect(planNodeAction({ ...node, capabilities: {} }, { kind: 'open' }, 'full')).toBeUndefined()
  })

  it('uses the shared service for a sidebar selection, folder open and file selection', async () => {
    const { service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    const sidebar = await service.act(base.stateId, [{ type: 'select', ref: base.outline.children![0].ref }])
    expect(sidebar.successorRoot?.title).toBe('Applications')
    const folder = service.getStateStore().get(sidebar.successorStateId)!.outline.children![0]
    const opened = await service.act(sidebar.successorStateId, [{ type: 'open', ref: folder.ref }])
    expect(opened.successorRoot?.title).toBe('Utilities')
    const file = service.getStateStore().get(opened.successorStateId)!.outline.children![0]
    const selected = await service.act(opened.successorStateId, [{ type: 'select', ref: file.ref }])
    expect(selected.diff.changed).toContainEqual(expect.objectContaining({ field: 'selected', to: 'true' }))
  })

  it('dispatches distinct select/open plans through the fast-loop adapter', async () => {
    const { service } = fixture()
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    let page = await adapter.observe()
    expect(page.elements[0].label).toBe('Select Applications')
    await adapter.click(page.elements[0].node)
    page = await adapter.observe()
    const folder = page.elements.find((element) => element.label === 'Open Utilities')!
    await adapter.click(folder.node)
    page = await adapter.observe()
    const file = page.elements.find((element) => element.label === 'Select Console')!
    // Files and unknown items are offered too; whether opening one is wanted is Jev's call.
    expect(page.elements.map((element) => element.label)).toEqual(expect.arrayContaining(['Open Console', 'Open Unknown']))
    await adapter.click(file.node)
    page = await adapter.observe()
    expect(page.elements.some((element) => element.label === 'Select Console')).toBe(false)
    expect(page.elements.find((element) => element.label === 'Open Console')?.ref).toBe(file.ref)
  })

  it.each(['select', 'open'] as const)('routes %s to AX without a pointer fallback', async (type) => {
    const { service } = fixture()
    const observation = await service.observe(undefined, 'semantic')
    const call = vi.fn(async (_method: string, _params?: unknown) => ({ ok: true, afterSelected: type === 'select' }))
    const adapter = new MacosPlatformAdapter({ client: { call } as never, getGrantedBundleIds: () => ['com.test.finder'] })
    await adapter.act({ root: observation.root, actions: [{ type, ref: observation.outline.children![0].ref }], outline: observation.outline })
    expect(call).toHaveBeenCalledWith('ax_action', expect.objectContaining({ action: type }))
    expect(call.mock.calls.some(([method]) => method === 'click')).toBe(false)
  })
})
