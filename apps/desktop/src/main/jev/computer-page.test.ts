import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { axTreeToOutline } from '../computer-use/platform/ax-outline'
import { ComputerUseError, type CapabilityTier } from '../computer-use/types'
import { createComputerAdapter, computerPage, computerObservation } from './computer-page'
import { buildActionSpace, clickVerb } from './action-space'
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

  it('lets the successor stand when the act itself outlasted the settle budget', async () => {
    // A 250-node Finder list costs ~9s a read. The act reads the successor
    // once; a settle then read it again, could never confirm stillness on a
    // single sample, and reported 'budget' every step — 18s a step for
    // nothing. Measured per act, so a cheap act settles as before.
    const { service, adapter } = fixture()
    await adapter.resolveTarget()
    const act = service.act.bind(service)
    const read = service.observe.bind(service)
    vi.useFakeTimers({ toFake: ['Date'] })
    const slow = <T,>(fn: () => Promise<T>, ms: number) => async () => { const result = await fn(); vi.setSystemTime(Date.now() + ms); return result }
    let next = 0
    try {
      // The window reads in 9s, and the act's successor read is one such read.
      const observe = vi.spyOn(service, 'observe').mockImplementation((...args) => slow(() => read(...args), 9000)())
      vi.spyOn(service, 'act').mockImplementation((...args) => slow(() => act(...args), 9000)())
      const page = await adapter.observe()
      next = page.elements.find((element) => element.label === 'Next')!.node
      await adapter.click(next)
      observe.mockClear()
      expect(await adapter.settle(page, { node: next })).toMatchObject({ changed: true, fields: ['act-outlasted-budget'] })
      expect(observe).not.toHaveBeenCalled()
      // The act's verdict still reaches the loop through its successor.
      expect(adapter.changed(page, await adapter.observe())).toBe(true)
      // A slow act on a window that reads quickly — a menu command pressed by
      // activating a background app — still settles: the read is affordable.
      observe.mockImplementation((...args) => slow(() => read(...args), 300)())
      const fresh = await adapter.observe()
      await adapter.click(next)
      expect((await adapter.settle(fresh, { node: next }))?.fields).not.toEqual(['act-outlasted-budget'])
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
    await adapter.observe()
    const observe = vi.spyOn(service, 'observe')
    await adapter.click(next)
    const report = await adapter.settle(await adapter.observe(), { node: next })
    expect(report?.fields).not.toEqual(['act-outlasted-budget'])
    expect(observe).toHaveBeenCalled()
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
    // On-screen content precedes app menu commands, which carry their menu's name.
    expect(labels.indexOf('File ▸ New Folder')).toBeGreaterThan(labels.indexOf('Open Folder 69'))
    const space = buildActionSpace({ page, history: [] })
    expect(space.clickCandidates).toContain(String(page.elements.find((element) => element.label === 'Open Readme.txt')!.node))
    expect(space.clickCandidates).toContain(String(page.elements.find((element) => element.label === 'Open Folder 69')!.node))
  })

  it('names a row\'s disclosure triangle after the row and offers it as Expand', async () => {
    // Finder's triangle has no name and keeps its state in AXValue ("0"/"1").
    // Offered as it came, four triangles were four unlabelled candidates: Jev
    // picked the right one by list order alone and, once Users had expanded,
    // could not see that it had.
    const { service } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    const row = (index: number, name: string, expanded: boolean) => ({ index, role: 'AXRow', selectable: true, actions: [], children: [
      { index: index + 1, role: 'AXTextField', value: name, actions: ['AXOpen'], itemKind: 'folder' as const },
      { index: index + 2, role: 'AXDisclosureTriangle', value: expanded ? '1' : '0', expanded, actions: ['AXPress'] },
    ] })
    const outline = axTreeToOutline({ index: 1, role: 'AXOutline', actions: [], children: [row(2, 'System', false), { ...row(5, 'Users', true), selected: true }] })
    const page = computerPage({ ...obs, outline }, service)
    // The state is in the text, where completion is judged: not "1", and a
    // selected row no longer just disappears from the candidates.
    expect(page.text).toContain('System\n(System: collapsed)')
    expect(page.text).toContain('(Users: selected)\nUsers\n(Users: expanded)')
    const triangles = page.elements.filter((e) => e.role === 'disclosuretriangle')
    expect(triangles.map((e) => [e.label, e.expanded, e.value])).toEqual([['System', 'false', ''], ['Users', 'true', '']])
    expect(triangles.map((e) => e.checked)).toEqual([undefined, undefined])
    expect(page.elements.map((e) => e.label)).toContain('Select System')
    const space = buildActionSpace({ page, history: [] })
    expect(clickVerb('click', space.elements.find((e) => e.index === String(triangles[0]!.node))!)).toBe('Expand')
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

  it('dispatches scroll as a semantic scroll-bar write, the same path computer_act takes with delivery=semantic', async () => {
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
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'scroll', ref: '@e99', dy: 600 }], expect.objectContaining({ delivery: 'semantic' }))
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

  it('keeps ruler and scroller positions out of the page text', async () => {
    // TextEdit's ruler put twenty tab-stop offsets ahead of the document text.
    const backend = new FakePlatformBackend([{ app: 'TextEdit', bundleId: 'com.test.textedit', pid: 7, windows: [{ title: 'Untitled', focused: true,
      tree: { role: 'window', children: [
        { role: 'scrollArea', bounds: { x: 0, y: 0, width: 586, height: 420 }, children: [
          { role: 'textArea', value: 'Jev sheet benchmark' },
          { role: 'ruler', children: [{ role: 'rulerMarker', value: '1.2698412698' }, { role: 'rulerMarker', value: '2.5396825396' }] },
          { role: 'scrollBar', value: '0.5', enabled: false, bounds: { x: 570, y: 0, width: 16, height: 420 } },
        ] },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'TextEdit', bundleId: 'com.test.textedit', tier: 'full' })
    const observed = await service.observe((await service.resolveTargetRoot()).rootId, 'semantic')
    const page = computerPage(computerObservation(service.getStateStore().get(observed.stateId)!), service)
    expect(page.text).toBe('Jev sheet benchmark')
    // A disabled scroller means the content fits; nothing to scroll to.
    expect(page.scrollRef).toBeDefined()
    expect(page.canScroll).toEqual({ up: false, down: false })
  })

  it('names a nameless pop-up button by what it shows', async () => {
    // TextEdit's save sheet: the file-format menu has no title, only its
    // current choice, and was offered as "button " next to a named Cancel.
    const backend = new FakePlatformBackend([{ app: 'TextEdit', bundleId: 'com.test.textedit', pid: 7, windows: [{ title: 'Save', focused: true,
      tree: { role: 'window', children: [
        { role: 'popUpButton', value: 'Rich Text Document', toggle: true },
        { role: 'checkbox', value: '1' },
        { role: 'button', name: 'Cancel' },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'TextEdit', bundleId: 'com.test.textedit', tier: 'full' })
    const observed = await service.observe((await service.resolveTargetRoot()).rootId, 'semantic')
    const page = computerPage(computerObservation(service.getStateStore().get(observed.stateId)!), service)
    // The toggle's value is its state; unnamed, it still has nothing to be called.
    expect(page.elements.map((e) => e.label)).toEqual(['Rich Text Document', 'Cancel'])
  })

  it('offers menu commands by their check mark, never the menus that open on the way', async () => {
    // The helper presses a command in the closed menu tree directly, activating
    // a background app for it, so a menu path is one press: "View" and
    // "Expand Sort By" are not steps. A chosen sort or view mode is shown
    // nowhere but the command's check mark (AXMenuItemMarkChar; AXValue is
    // empty).
    const { service } = fixture()
    const obs = await service.observe(undefined, 'semantic')
    // The window's own "Date Modified" — a column header — is a different
    // control with the same name; both are offered.
    const outline = axTreeToOutline({ index: 1, role: 'AXWindow', children: [{ index: 2, role: 'AXButton', name: 'Date Modified', actions: ['AXPress'] }] }, { index: 1, role: 'AXMenuBar', children: [
      { index: 2, role: 'AXMenuBarItem', name: 'View', actions: ['AXPress'], children: [{ index: 3, role: 'AXMenu', children: [
        { index: 4, role: 'AXMenuItem', name: 'Sort By', actions: ['AXPress'], expanded: false, children: [{ index: 5, role: 'AXMenu', children: [
          { index: 6, role: 'AXMenuItem', name: 'Name', actions: ['AXPress'] },
          { index: 7, role: 'AXMenuItem', name: 'Date Modified', actions: ['AXPress'], checked: true },
        ] }] },
      ] }] },
    ] })
    const page = computerPage({ ...obs, outline }, service)
    const labels = page.elements.map((e) => e.label)
    // A command carries its menu's name: on its own, "12" under Decimal Places
    // read as the digits a goal asked for.
    expect(labels).toEqual(['Date Modified', 'Sort By ▸ Name', 'Sort By ▸ Date Modified'])
    expect(page.elements[1]).toMatchObject({ clickable: true })
    expect(page.elements[1].checked).toBeUndefined()
    expect(page.elements[2]).toMatchObject({ checked: 'true' })
    expect(page.elements[2].expanded).toBeUndefined()
    const space = buildActionSpace({ page, history: [] })
    expect(space.elements.filter((e) => e.label.endsWith('Date Modified')).map((e) => e.checked)).toEqual([undefined, 'true'])
  })

  it('re-resolves the app root when the observed window is replaced', async () => {
    // System Settings swaps its whole window when the sidebar search resolves;
    // the helper then refuses the old window id and the error escaped the run
    // as a failed tool call, with the typed query already on screen.
    const { adapter, service } = fixture()
    await adapter.resolveTarget()
    const real = service.observe.bind(service)
    let thrown = false
    vi.spyOn(service, 'observe').mockImplementation(async (root, mode) => {
      if (!thrown) {
        thrown = true
        // The helper raises a plain Error with a `code`, never a
        // ComputerUseError — matching on the class alone caught nothing, which
        // is how this escaped `computer_run` twice as a failed tool call.
        throw Object.assign(new Error('Window 8570 no longer exists'), { code: 'WINDOW_UNAVAILABLE' })
      }
      return real(root, mode)
    })
    const page = await adapter.observe()
    expect(page.elements.length).toBeGreaterThan(0)
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
