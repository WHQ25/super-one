import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { FakePlatformBackend } from '../platform/fake-backend'
import { resolveUiRoot, selectAppRoot } from '../root-selection'
import type { UiRootIdentity } from '../types'

const main: UiRootIdentity = {
  rootId: '@r1', kind: 'window', app: 'Calculator', bundleId: 'com.apple.calculator', pid: 42,
  title: 'Calculator', bounds: { x: 0, y: 0, width: 400, height: 600 },
  focused: false, visible: true, minimized: false, modal: false, resourceKey: 'pid:42',
}
const strip = { ...main, rootId: '@r2', focused: true, title: 'Window', bounds: { x: 0, y: 0, width: 130, height: 28 } }

describe('app root selection', () => {
  it('ignores a focused sharing strip and keeps selection inside the target app', () => {
    const other = { ...main, rootId: '@r3', bundleId: 'other', bounds: { x: 0, y: 0, width: 1200, height: 1000 } }
    expect(resolveUiRoot([strip, other, main])).toBe(main)
    expect(resolveUiRoot([other, strip, main], { bundleId: main.bundleId })).toBe(main)
    expect(resolveUiRoot([other, strip, main], { preferredBundleId: main.bundleId })).toBe(main)
  })

  it('excludes empty, tiny, hidden and minimized ordinary windows', () => {
    for (const bad of [strip, { ...main, title: ' ' }, { ...main, visible: false }, { ...main, minimized: true }]) {
      expect(selectAppRoot([bad])).toBeUndefined()
      expect(() => resolveUiRoot([bad], { bundleId: main.bundleId })).toThrow('no usable window')
    }
  })

  it('prefers a modal or active popover, then the largest ordinary window', () => {
    const modal = { ...strip, kind: 'dialog' as const, modal: true }
    const popover = { ...strip, kind: 'popover' as const }
    const smaller = { ...main, focused: true, bounds: { x: 0, y: 0, width: 300, height: 200 } }
    expect(selectAppRoot([main, modal])).toBe(modal)
    expect(selectAppRoot([main, popover])).toBe(popover)
    expect(selectAppRoot([smaller, main])).toBe(main)
  })

  it('honors an explicit auxiliary root and never substitutes a missing root', () => {
    expect(resolveUiRoot([main, strip], { rootId: strip.rootId })).toBe(strip)
    expect(() => resolveUiRoot([main], { rootId: strip.rootId })).toThrow('Unknown root')
  })

  it('uses the same selection for launch, implicit snapshot and app resolution', async () => {
    const backend = new FakePlatformBackend([{
      app: main.app, bundleId: main.bundleId, pid: main.pid,
      windows: [strip, main].map((root) => ({ title: root.title, bounds: root.bounds, focused: root.focused,
        tree: { role: 'window', name: root.title } })),
    }])
    const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
    service.policy.setEnabled(true)
    const launched = await service.apps('launch', main.bundleId)
    const root = await service.resolveTargetRoot(undefined, main.bundleId)
    expect(root.title).toBe('Calculator')
    expect(launched).toMatchObject({ target: { rootId: root.rootId } })
    expect((await service.observe()).root.rootId).toBe(root.rootId)
  })
})
