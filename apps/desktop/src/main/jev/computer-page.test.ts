import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { axTreeToOutline } from '../computer-use/platform/ax-outline'
import { ComputerUseError, type CapabilityTier } from '../computer-use/types'
import { createComputerAdapter, computerPage, computerObservation } from './computer-page'
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
const options = { goal: 'Fill Title with Hello', presets: [{ key: 'Title', value: 'Hello' }], maxSteps: 3, maxWallMs: 45000 }

describe('computer fast-loop adapter', () => {
  it('returns the verified new panel and uses its nodes after crossing roots', async () => {
    const backend = new FakePlatformBackend([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7, windows: [{ title: 'Document', tree: {
      role: 'window', children: [{ role: 'button', name: 'Show Fonts', opensModal: { title: 'Fonts', kind: 'window', buttonName: 'Close' } }],
    } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Editor', bundleId: 'com.test.editor', tier: 'full' })
    const ask = vi.fn(async (request: JevRequest) => ({ answers: { goal_satisfied: noul(0), still_loading: noul(0), action: pick('click', Object.keys(request.questions.action.criteria!)), click_target: pick('1', Object.keys(request.questions.click_target.criteria!)) }, model: 'test', usage: {}, latencyMs: 1 }))
    const adapter = createComputerAdapter({ service, ask, doneWhen: { kind: 'newRoot', title: 'Fonts' }, resolve: async () => (await service.resolveTargetRoot()).rootId })
    adapter.trace = () => {}
    const run = new FastRun({ ...options, goal: 'Show Fonts', presets: [], hasDoneWhen: true }, adapter)
    const result = await run.start()
    expect(result.status).toBe('done')
    expect(result.snapshot?.title).toContain('Fonts')
    expect(ask).toHaveBeenCalledTimes(1)
    const page = await adapter.observe()
    expect(page.elements.map((element) => element.label)).toContain('Close')
    expect(page.elements.map((element) => element.label)).not.toContain('Show Fonts')
  })

  it('waits and settles for itself, because act only holds for an expect and changed() reads its verdict', async () => {
    // Two gaps the browser adapter closed long ago: computer_act returns on its
    // first read unless the plan carries an `expect` (only setText does), and
    // the loop's wait fallback decides with changed(), whose verdict lives on
    // an act's successor — never on a plain observation.
    const { adapter } = fixture()
    expect(adapter.waitForChange).toBeDefined()
    const page = await adapter.observe()
    expect(adapter.changed(page, page)).toBeNull()

    // Settling keeps the act's verdict on the observation it hands back, or the
    // loop would read "change unknown" for every action it took.
    const run = new FastRun(options, adapter)
    const result = await run.start()
    expect(result.since_last.join(' ')).not.toContain('change unknown')
  })

  it('names list rows by their text, offers one candidate per intent and sees past the fold budget', async () => {
    // A Finder list: unnamed rows whose name cell and its text field both open the item.
    const row = (name: string, itemKind: 'folder' | 'file') => ({ role: 'row', selectable: true, children: [
      // Only the name field carries file metadata, as on macOS; the cell must inherit it.
      { role: 'cell', openable: true, children: [{ role: 'textField', name: '', value: name, openable: true, itemKind }] },
      { role: 'cell', children: [{ role: 'staticText', value: 'Sep 3' }] },
      { role: 'cell', children: [{ role: 'staticText', value: '--' }] },
      { role: 'cell', children: [{ role: 'staticText', value: 'Folder' }] },
    ] })
    const rows = Array.from({ length: 70 }, (_, i) => row(`Folder ${String(i).padStart(2, '0')}`, 'folder'))
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7,
      menuBar: { role: 'menuBar', children: [
        { role: 'menuBarItem', name: 'Apple', children: [{ role: 'menuItem', name: 'Recent Secret.pdf' }] },
        { role: 'menuBarItem', name: 'File', children: [{ role: 'menuItem', name: 'New Folder' }] },
      ] },
      windows: [{ title: 'Macintosh HD', tree: { role: 'window', children: [...rows, row('Readme.txt', 'file')] } }],
    }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const labels = page.elements.map((element) => element.label)
    expect(labels.filter((label) => label === 'Open Folder 07')).toHaveLength(1)
    expect(labels).toContain('Select Folder 07')
    // 70 rows (630 nodes) are more than the model-facing fold keeps, but the run reads the complete state.
    expect(labels).toContain('Open Folder 69')
    expect(labels.some((label) => /^(Open|Select) ?$/.test(label))).toBe(false)
    expect(labels).not.toContain('Recent Secret.pdf')
    expect(page.text).not.toContain('Recent Secret.pdf')
    // On-screen content precedes app menu commands.
    expect(labels.indexOf('New Folder')).toBeGreaterThan(labels.indexOf('Open Folder 69'))
    const space = buildActionSpace({ page, history: [] })
    expect(space.clickCandidates).toContain(String(page.elements.find((element) => element.label === 'Open Readme.txt')!.node))
    expect(space.clickCandidates).toContain(String(page.elements.find((element) => element.label === 'Open Folder 69')!.node))
  })

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
    const space = buildActionSpace({ page, history: [] })
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
    expect(result).toMatchObject({ status: 'paused', question: { reason: 'no-progress' } })
    expect(read.ask).not.toHaveBeenCalled()
  })

  it('offers every enabled control at full tier; risk is Jev\'s call, not a label rule', async () => {
    const { adapter } = fixture()
    await adapter.resolveTarget()
    const space = buildActionSpace({ page: await adapter.observe(), history: [] })
    const index = (label: string) => space.elements.find((e) => e.label === label)?.index
    expect(space.clickCandidates).toContain(index('Delete'))
    expect(space.clickCandidates).toContain(index('Next'))
    expect(index('Disabled')).toBeUndefined()
  })

  it('invalidates states after a competing write and always reads anew on resume', async () => {
    const { adapter, service } = fixture()
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const next = page.elements.find((e) => e.label === 'Next')!
    await service.act(page.stateId, [{ type: 'press', ref: next.ref! }], { delivery: 'semantic' })
    expect(await adapter.isFresh(page, next.node)).toBe(false)
    expect(adapter.reobserveOnResume).toBe(true)
    // Menu churn alone must not discard the answer; a moved element must.
    expect(adapter.sameTarget?.(page, { ...page, signature: 'changed' }, next)).toBe(true)
    const moved = new Map(page.refs)
    moved.set(next.node, { ...page.refs.get(next.node)!, ref: '@e99' })
    expect(adapter.sameTarget?.(page, { ...page, refs: moved }, next)).toBe(false)
    expect(adapter.sameTarget?.(page, { ...page, elements: page.elements.map((e) => e.node === next.node ? { ...e, label: 'Other' } : e) }, next)).toBe(false)
  })

  it.each(['MODAL_BLOCKED', 'TIER_BLOCKED'] as const)('pauses once on %s instead of retrying', async (code) => {
    const { adapter, service } = fixture()
    const act = vi.spyOn(service, 'act').mockRejectedValue(new ComputerUseError(code, 'Blocked test action'))
    const result = await new FastRun(options, adapter).start()
    expect(result.question).toMatchObject({ reason: 'no-progress', context: { why: 'Blocked test action' } })
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

  it('offers an anonymous text field, which is what a macOS search box is', async () => {
    // System Settings' sidebar search has no AXTitle, AXDescription or AXLabel,
    // and an empty one has no value either. It used to be dropped outright: the
    // live run saw 112 elements, every one of them a button, so the action head
    // was never offered type_text and could only click and scroll until it
    // paused. Every other fixture here names its fields, which is why no test
    // caught it.
    const backend = new FakePlatformBackend([{ app: 'Settings', bundleId: 'com.test.settings', pid: 7, windows: [{ title: 'General', focused: true,
      tree: { role: 'window', children: [
        { role: 'textField', value: '' },
        { role: 'button', name: 'General' },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Settings', bundleId: 'com.test.settings', tier: 'full' })
    const observed = await service.observe((await service.resolveTargetRoot()).rootId, 'semantic')
    const page = computerPage(computerObservation(service.getStateStore().get(observed.stateId)!), service)
    const field = page.elements.find((e) => e.editable)
    expect(field).toMatchObject({ role: 'textbox', label: 'Text field' })
    expect(buildActionSpace({ page, history: [] }).typeCandidates).toEqual([String(field!.node)])
  })

  it('reports a toggle as checked, not as the raw AX number', async () => {
    // AXValue on a checkbox is a number, so the observation carried "1" and the
    // shared layer — which speaks aria-checked's 'true'/'false' — saw nothing.
    // Jev was never told whether a switch was on, and the settle signature
    // could not see one flip either.
    const backend = new FakePlatformBackend([{ app: 'Settings', bundleId: 'com.test.settings', pid: 7, windows: [{ title: 'Network', focused: true,
      tree: { role: 'window', children: [
        { role: 'checkbox', name: 'Wi-Fi', value: '1' },
        { role: 'checkbox', name: 'Bluetooth', value: '0' },
        { role: 'button', name: 'Done' },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Settings', bundleId: 'com.test.settings', tier: 'full' })
    const observed = await service.observe((await service.resolveTargetRoot()).rootId, 'semantic')
    const page = computerPage(computerObservation(service.getStateStore().get(observed.stateId)!), service)
    expect(page.elements.map((e) => [e.label, e.checked])).toEqual([['Wi-Fi', 'true'], ['Bluetooth', 'false'], ['Done', undefined]])
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
