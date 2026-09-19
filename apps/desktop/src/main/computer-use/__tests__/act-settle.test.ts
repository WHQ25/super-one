import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { FakePlatformBackend } from '../platform/fake-backend'

/**
 * A SwiftUI app (Calculator) publishes its accessibility update a few hundred
 * milliseconds after a press. The successor snapshot must wait for the
 * outline to move before it reports "nothing changed".
 */
function fixture() {
  const backend = new FakePlatformBackend([{ app: 'Calc', bundleId: 'com.test.calc', pid: 7, windows: [{ title: 'Calc', tree: {
    role: 'window', children: [{ role: 'staticText', name: 'Edit field', value: '0' }, { role: 'button', name: 'Sine' }],
  } }] }])
  backend.silentDelivery = true // the press itself mutates nothing
  const service = new ComputerUseService({ adapter: backend, bypassPolicy: true, clock: () => backend.nowMs })
  return { backend, service }
}

describe('act settles an unchanged successor outline', () => {
  it('re-reads until a late accessibility update shows up, then reports the diff', async () => {
    const { backend, service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    const originalLook = backend.look.bind(backend)
    let updated = false
    backend.look = async (...args) => {
      // The app applies the press 250 ms of fake time later.
      if (!updated && backend.nowMs >= 250) {
        backend.replaceWindowTree(7, 'Calc', { role: 'window', children: [{ role: 'staticText', name: 'Edit field', value: 'sine (' }, { role: 'button', name: 'Sine' }] })
        updated = true
      }
      return originalLook(...args)
    }
    const result = await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![1].ref }], { delivery: 'semantic' })
    expect(result.diff.changed.length + result.diff.added.length).toBeGreaterThan(0)
    expect(backend.nowMs).toBeGreaterThanOrEqual(250)
    expect(backend.nowMs).toBeLessThan(600)
  })

  it('gives up after the settle budget when nothing moves', async () => {
    const { backend, service } = fixture()
    const base = await service.observe(undefined, 'semantic')
    const result = await service.act(base.stateId, [{ type: 'press', ref: base.outline.children![1].ref }], { delivery: 'semantic' })
    expect(result.diff).toMatchObject({ added: [], removed: [], changed: [] })
    expect(backend.nowMs).toBeGreaterThanOrEqual(600)
  })
})
