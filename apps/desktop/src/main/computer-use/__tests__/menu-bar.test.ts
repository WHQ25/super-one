import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { FakePlatformBackend } from '../platform/fake-backend'
import { axTreeToOutline } from '../platform/ax-outline'
import { MacosPlatformAdapter } from '../platform/macos-adapter'
import type { UiOutlineNode, UiRootIdentity } from '../types'
import { computerPage } from '../../jev/computer-page'

const flatten = (node: UiOutlineNode): UiOutlineNode[] => [node, ...(node.children ?? []).flatMap(flatten)]

describe('app menu bar in window outlines', () => {
  const wire = {
    tree: { index: 1, role: 'AXWindow', name: 'Document', children: [{ index: 12, role: 'AXButton', name: 'Format', actions: ['AXPress'] }] },
    menuBar: { index: 1, role: 'AXMenuBar', children: [{ index: 2, role: 'AXMenuBarItem', name: 'Format', actions: ['AXPress'] }] },
    display: { width: 1440, height: 900 },
  }

  it('preserves window refs and gives the independent menu tree unique refs', () => {
    const nodes = flatten(axTreeToOutline(wire.tree, wire.menuBar))
    expect(nodes.map((node) => node.ref)).toEqual(['@e1', '@e13', '@e14', '@e12'])
    expect(nodes[3].nativeTarget).toBeUndefined()
    expect(nodes[2]).toMatchObject({ nativeTarget: { scope: 'menuBar', index: 2 }, capabilities: { press: true } })
  })

  it('dispatches the menu source and native index, not the same-named window button', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'ax_tree') return wire
      return { ok: true, index: 2 }
    })
    const adapter = new MacosPlatformAdapter({ client: { call } as never, getGrantedBundleIds: () => ['com.test.editor'] })
    const root: UiRootIdentity = { rootId: '@r1', kind: 'window', app: 'Editor', bundleId: 'com.test.editor', pid: 42,
      title: 'Document', bounds: { x: 30, y: 40, width: 800, height: 600 }, focused: true, visible: true,
      minimized: false, modal: false, resourceKey: 'pid:42' }
    const look = await adapter.look(root, 'semantic')
    const menu = flatten(look.outline).find((node) => node.name === 'Format' && node.nativeTarget)!
    await adapter.act({ root, actions: [{ type: 'press', ref: menu.ref }], delivery: 'semantic', outline: look.outline })
    expect(call).toHaveBeenCalledWith('ax_action', expect.objectContaining({ pid: 42, index: 2, axSource: 'menuBar', action: 'press', expectedName: 'Format' }))
    expect(call.mock.calls.some(([name]) => name === 'click')).toBe(false)
  })

  function fixture(blocker?: 'menu' | 'dialog') {
    const backend = new FakePlatformBackend([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7,
      menuBar: { role: 'menuBar', children: [{ role: 'menuBarItem', name: 'Format', toggle: true }] },
      windows: [{ title: 'Document', focused: true, tree: { role: 'window', children: [{ role: 'button', name: 'Format', toggle: true }] } },
        ...(blocker ? [{ title: 'Blocker', kind: blocker, modal: true, tree: { role: blocker } }] : [])],
    }])
    return new ComputerUseService({ adapter: backend, bypassPolicy: true })
  }

  it('supports menu observation, query and semantic act through the shared service', async () => {
    const service = fixture()
    const observation = await service.observe(undefined, 'semantic')
    const nodes = flatten(observation.outline)
    const menu = nodes.find((node) => node.name === 'Format' && node.nativeTarget)!
    const button = nodes.find((node) => node.name === 'Format' && !node.nativeTarget)!
    expect(menu.ref).not.toBe(button.ref)
    expect(await service.query(observation.stateId, 'inspect', { ref: menu.ref })).toMatchObject({ element: { role: 'menuBarItem', name: 'Format' } })
    const result = await service.act(observation.stateId, [{ type: 'press', ref: menu.ref }], { delivery: 'semantic' })
    expect(result.outcome).toBe('worked')
    const next = service.getStateStore().get(result.successorStateId)!
    expect(flatten(next.outline).find((node) => node.ref === menu.ref)?.value).toBe('on')
    expect(flatten(next.outline).find((node) => node.ref === button.ref)?.value).toBeUndefined()
  })

  it('enumerates closed submenus and directly presses a nested command', async () => {
    const backend = new FakePlatformBackend([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7,
      menuBar: { role: 'menuBar', children: [{ role: 'menuBarItem', name: 'Format', children: [
        { role: 'menu', children: [{ role: 'menuItem', name: 'Font', children: [
          { role: 'menu', children: [{ role: 'menuItem', name: 'Show Fonts',
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            opensModal: { title: 'Fonts', kind: 'window', buttonName: 'Close' } }] },
        ] }] },
      ] }] },
      windows: [{ title: 'Document', tree: { role: 'window' } }],
    }])
    const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
    service.policy.grantSession({ app: 'Editor', bundleId: 'com.test.editor', tier: 'full' })
    const observation = await service.observe(undefined, 'semantic')
    const command = flatten(observation.outline).find((node) => node.name === 'Show Fonts')!
    expect(command.nativeTarget?.scope).toBe('menuBar')
    expect(computerPage(observation, service).elements).toContainEqual(expect.objectContaining({ label: 'Font ▸ Show Fonts', clickable: true }))
    const result = await service.act(observation.stateId, [{ type: 'press', ref: command.ref }], { delivery: 'semantic' })
    expect(result.successorRoot?.title).toBe('Fonts')
    expect((await service.waitFor(observation.stateId, { kind: 'newRoot', title: 'Fonts' }, 0)).status).toBe('verified')
  })

  it('presses a menu command in a background app and only makes it frontmost on focus activate', async () => {
    // AppKit validates menu items against the active app's key window, so the
    // helper makes the app believe it is active for the press, without
    // bringing it forward;
    // the service neither gates on frontmost nor changes it. Plain focus keeps
    // the app in the background; activate is for holding it in front.
    const backend = new FakePlatformBackend([
      { app: 'Chat', bundleId: 'com.test.chat', pid: 3, windows: [{ title: 'Chat', focused: true, tree: { role: 'window' } }] },
      { app: 'Editor', bundleId: 'com.test.editor', pid: 7,
        menuBar: { role: 'menuBar', children: [{ role: 'menuBarItem', name: 'Format', toggle: true }] },
        windows: [{ title: 'Document', focused: false, tree: { role: 'window' } }] },
    ])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Editor', bundleId: 'com.test.editor', tier: 'full' })
    const root = (await service.listUiRoots()).find((candidate) => candidate.title === 'Document')!
    const observation = await service.observe(root.rootId, 'semantic')
    const menu = flatten(observation.outline).find((node) => node.name === 'Format' && node.nativeTarget)!
    expect((await service.act(observation.stateId, [{ type: 'press', ref: menu.ref }], { delivery: 'semantic' })).outcome).toBe('worked')
    expect(await backend.frontmost()).toMatchObject({ bundleId: 'com.test.chat' })

    await service.apps('focus', 'com.test.editor')
    expect(await backend.frontmost()).toMatchObject({ bundleId: 'com.test.chat' })
    await service.apps('focus', 'com.test.editor', { activate: true })
    expect(await backend.frontmost()).toMatchObject({ bundleId: 'com.test.editor' })
  })

  it.each(['menu', 'dialog'] as const)('keeps %s obstruction scoped to the actual target', async (blocker) => {
    const service = fixture(blocker)
    const roots = await service.listUiRoots()
    const root = roots.find((candidate) => candidate.title === 'Document')!
    const observation = await service.observe(root.rootId, 'semantic')
    const menu = flatten(observation.outline).find((node) => node.name === 'Format' && node.nativeTarget)!
    const transaction = service.act(observation.stateId, [{ type: 'press', ref: menu.ref }], { delivery: 'semantic' })
    if (blocker === 'menu') expect((await transaction).outcome).toBe('worked')
    else await expect(transaction).rejects.toMatchObject({ code: 'MODAL_BLOCKED' })
  })
})
