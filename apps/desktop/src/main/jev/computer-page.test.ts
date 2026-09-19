import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { axTreeToOutline } from '../computer-use/platform/ax-outline'
import { ComputerUseError, type CapabilityTier } from '../computer-use/types'
import { createComputerAdapter, computerPage } from './computer-page'
import { buildActionSpace } from './action-space'
import { FastRun } from './loop'
import { noul, pick } from './test-fixtures'
import type { JevRequest } from './typesafe-client'

function fixture(tier: CapabilityTier = 'full') {
  const backend = new FakePlatformBackend([{ app: 'Notes', bundleId: 'com.test.notes', pid: 7, windows: [{ title: 'Scratch', focused: true,
    tree: { role: 'window', children: [
      { role: 'textField', name: 'Title', value: '' },
      { role: 'button', name: 'Delete', toggle: true },
      { role: 'button', name: 'Next', toggle: true },
      { role: 'textField', name: 'Disabled', enabled: false },
    ] },
  }] }])
  const service = new ComputerUseService({ adapter: backend })
  service.policy.setEnabled(true)
  service.policy.grantSession({ app: 'Notes', bundleId: 'com.test.notes', tier })
  const ask = vi.fn(async (request: JevRequest) => {
    const choices = Object.keys(request.questions.action.criteria ?? {})
    const fields = Object.keys(request.questions.type_text_target?.criteria ?? {})
    return { answers: { goal_satisfied: noul(0), still_loading: noul(0), action: pick(fields.length ? 'type_text' : 'none_useful', choices), type_text_target: pick(fields[0], fields) }, model: 'test', usage: {}, latencyMs: 1 }
  })
  const adapter = createComputerAdapter({ service, ask, resolve: async () => (await service.resolveTargetRoot()).rootId })
  adapter.trace = () => {}
  return { service, backend, ask, adapter }
}
const options = { goal: 'Fill Title with Hello', presets: [{ key: 'Title', value: 'Hello' }], allow: [], avoid: [], maxSteps: 3, maxWallMs: 45000 }

describe('computer fast-loop adapter', () => {
  it('offers only replacements supported by the semantic delivery path', async () => {
    const { service } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    const outline = axTreeToOutline({ index: 1, role: 'AXTextField', name: 'Keyboard only', settable: false })
    expect(outline.capabilities?.typeText).toBe(true)
    expect(computerPage({ ...obs, outline }, service).elements).toEqual([])
  })

  it('withholds submit candidates for fields without application focus', async () => {
    const { service } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    const outline = axTreeToOutline({ index: 1, role: 'AXTextField', name: 'Search', value: 'cats', settable: true })
    const page = computerPage({ ...obs, outline }, service)
    const space = buildActionSpace({ page, origins: new Set(), allow: ['Enter'], avoid: [], history: [] })
    expect(space.typeCandidates).toHaveLength(1)
    expect(space.clickCandidates.some((candidate) => candidate.startsWith('submit:'))).toBe(false)
  })

  it('dispatches observed presses through semantic computer_act', async () => {
    const { adapter, service } = fixture()
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const button = page.elements.find((element) => element.label === 'Next')!
    const act = vi.spyOn(service, 'act')
    await adapter.click(button.node)
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'press', ref: button.ref }], expect.objectContaining({ delivery: 'semantic' }))
  })

  it('keeps focused Return executable after outline folding', async () => {
    const { adapter, backend, service } = fixture()
    const look = backend.look.bind(backend)
    vi.spyOn(backend, 'look').mockImplementation(async (...args) => {
      const observed = await look(...args)
      observed.outline.children![0].appFocused = true
      observed.outline.children![0].value = 'cats'
      return observed
    })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const field = page.elements.find((element) => element.label === 'Title')!
    expect(field.canSubmit).toBe(true)
    const act = vi.spyOn(service, 'act')
    await adapter.pressEnter(field.node)
    expect(act).toHaveBeenCalledWith(expect.any(String), [{ type: 'keypress', keys: ['Return'] }], expect.objectContaining({ delivery: 'app-directed' }))
  })

  it('dispatches scroll through the same app-directed path as computer_act', async () => {
    const { adapter, backend, service } = fixture()
    const look = backend.look.bind(backend)
    vi.spyOn(backend, 'look').mockImplementation(async (...args) => {
      const observed = await look(...args)
      observed.outline.children!.push({ ref: '@e99', role: 'scrollArea', capabilities: { scroll: true }, bounds: { x: 0, y: 0, width: 300, height: 200 } })
      return observed
    })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    expect(page.canScroll?.down).toBe(true)
    const act = vi.spyOn(service, 'act')
    await adapter.scroll(page, 600)
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'scroll', ref: '@e99', dy: 600 }], expect.objectContaining({ delivery: 'app-directed' }))
  })

  it('uses semantic replacement, verifies valueEquals and reuses the successor observation', async () => {
    const { adapter, service, ask } = fixture()
    await adapter.resolveTarget()
    const initial = await adapter.observe()
    const field = initial.elements.find((e) => e.label === 'Title')!
    const act = vi.spyOn(service, 'act')
    const observe = vi.spyOn(service, 'observe')
    await adapter.type(field.node, 'Hello')
    const next = await adapter.observe()
    expect(act).toHaveBeenCalledWith(initial.stateId, [{ type: 'setText', ref: field.ref, text: 'Hello' }], expect.objectContaining({ delivery: 'semantic', expect: { kind: 'valueEquals', ref: field.ref, value: 'Hello' } }))
    expect(observe).not.toHaveBeenCalled()
    expect(next.elements.find((e) => e.node === field.node)?.value).toBe('Hello')
    expect(adapter.changed(initial, next)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('finishes with the native condition without a second model round trip', async () => {
    const { service, ask } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    const field = computerPage(obs, service).elements.find((e) => e.label === 'Title')!
    const adapter = createComputerAdapter({ service, ask, resolve: async () => obs.root.rootId, doneWhen: { kind: 'valueEquals', ref: field.ref!, value: 'Hello' } })
    adapter.trace = () => {}
    const result = await new FastRun({ ...options, hasDoneWhen: true }, adapter).start()
    expect(result.status).toBe('done')
    expect(result.snapshot?.stateId).toBeTruthy()
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('withholds writes at click tier and pauses at read tier', async () => {
    const click = fixture('click')
    await click.adapter.resolveTarget()
    const page = await click.adapter.observe()
    expect(page.elements.some((e) => e.editable)).toBe(false)
    expect(page.elements.some((e) => e.label === 'Disabled')).toBe(false)
    const read = fixture('read')
    const result = await new FastRun(options, read.adapter).start()
    expect(result).toMatchObject({ status: 'paused', question: { reason: 'guarded-only' } })
    expect(read.ask).not.toHaveBeenCalled()
  })

  it('keeps the shared risk whitelist independent of capability grants', async () => {
    const { adapter } = fixture()
    await adapter.resolveTarget()
    const space = buildActionSpace({ page: await adapter.observe(), origins: new Set(), allow: [], avoid: [], history: [] })
    expect(space.guarded.map((e) => e.label)).toContain('Delete')
    expect(space.clickCandidates).toContain(space.elements.find((e) => e.label === 'Next')?.index)
  })

  it('invalidates states after a competing write and always reads anew on resume', async () => {
    const { adapter, service } = fixture()
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const next = page.elements.find((e) => e.label === 'Next')!
    await service.act(page.stateId, [{ type: 'press', ref: next.ref! }], { delivery: 'semantic' })
    expect(await adapter.isFresh(page, next.node)).toBe(false)
    expect(adapter.reobserveOnResume).toBe(true)
    expect(adapter.sameTarget?.(page, { ...page, signature: 'changed' }, next)).toBe(false)
  })

  it.each(['MODAL_BLOCKED', 'TIER_BLOCKED'] as const)('pauses once on %s instead of retrying', async (code) => {
    const { adapter, service } = fixture()
    const act = vi.spyOn(service, 'act').mockRejectedValue(new ComputerUseError(code, 'Blocked test action'))
    const result = await new FastRun(options, adapter).start()
    expect(result.question).toMatchObject({ reason: 'guarded-only', context: { why: 'Blocked test action' } })
    expect(act).toHaveBeenCalledTimes(1)
  })

  it('strips secure values before either state or candidates are built', async () => {
    const { service } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    const outline = axTreeToOutline({ index: 1, role: 'AXTextField', secure: true, name: 'Credential', value: 'never-export', settable: true })
    expect(outline.value).toBeUndefined()
    const page = computerPage({ ...obs, outline }, service)
    expect(JSON.stringify(page)).not.toContain('never-export')
    expect(page.elements).toEqual([])
  })

  it('does not emit Return when the target is not the app AX focus owner', async () => {
    const { adapter, service } = fixture()
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const act = vi.spyOn(service, 'act')
    await expect(adapter.pressEnter(page.elements[0].node)).rejects.toThrow('not the app-focused')
    expect(act).not.toHaveBeenCalled()
  })

  it('honors cancellation before dispatching an input', async () => {
    const { adapter, service } = fixture()
    const controller = new AbortController()
    controller.abort()
    const act = vi.spyOn(service, 'act')
    expect((await new FastRun(options, adapter).start(controller.signal)).status).toBe('aborted')
    expect(act).not.toHaveBeenCalled()
  })
})
