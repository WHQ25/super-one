import { describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { axTreeToOutline } from '../computer-use/platform/ax-outline'
import { ComputerUseError, type CapabilityTier } from '../computer-use/types'
import { createComputerAdapter, computerPage, computerObservation } from './computer-page'
import * as screenshotStore from '../computer-use/screenshot-store'
import { buildActionSpace, clickVerb } from './action-space'
import { FastRun, StaleObservation } from './loop'
import { buildRequest } from './questions'
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
    expect(result.progress.completed.map((step) => step.outcome)).not.toContain('unknown')
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

  it('offers only replacements the target can take as an exact value', async () => {
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
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'press', ref: button.ref }], expect.any(Object))
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
    expect(act).toHaveBeenCalledWith(expect.any(String), [{ type: 'keypress', keys: ['Return'] }], expect.any(Object))
  })

  it('dispatches scroll on the scroll area ref, which computer_act pages by its scroll bar', async () => {
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
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'scroll', ref: '@e99', dy: 600 }], expect.any(Object))
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
    expect(act).toHaveBeenCalledWith(initial.stateId, [{ type: 'setText', ref: field.ref, text: 'Hello' }], expect.objectContaining({ expect: { kind: 'valueEquals', ref: field.ref, value: 'Hello' } }))
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
    await service.act(page.stateId, [{ type: 'press', ref: next.ref! }])
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
    expect(page.text.split('\n')).toEqual(['(observing: TextEdit window "Untitled"; no sheet or dialog open)', 'Jev sheet benchmark', '(text area "Jev sheet benchmark": ends with "Jev sheet benchmark")'])
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

  it('offers every scroll area by what it holds, and scrolls the one Jev names', async () => {
    // A Finder window has two: the sidebar and the list. Only the first DFS hit
    // used to be the scroll target, so a goal three pages down the list scrolled
    // the sidebar. Each area with room to move is a candidate named by its
    // content; the direction still comes from the action head.
    const row = (name: string) => ({ role: 'row', selectable: true, children: [{ role: 'cell', children: [{ role: 'staticText', value: name }] }] })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'Macintosh HD', focused: true,
      tree: { role: 'window', children: [
        // Finder names its containers ("sidebar", "list view"); that name is
        // the kind of content, not a row — read as one it gave "List starting
        // at list view".
        { role: 'scrollArea', bounds: { x: 0, y: 0, width: 200, height: 400 }, children: [
          { role: 'outline', name: 'sidebar', children: [row('AirDrop'), row('Recents')] },
          { role: 'scrollBar', value: '0', bounds: { x: 184, y: 0, width: 16, height: 400 } },
        ] },
        { role: 'scrollArea', bounds: { x: 200, y: 0, width: 600, height: 400 }, children: [
          { role: 'table', children: [row('Applications'), row('Library')] },
          { role: 'scrollBar', value: '0.3', bounds: { x: 784, y: 0, width: 16, height: 400 } },
        ] },
        // Content that fits is not somewhere to scroll.
        { role: 'scrollArea', bounds: { x: 0, y: 400, width: 800, height: 100 }, children: [
          { role: 'textArea', value: 'Status' },
          { role: 'scrollBar', value: '0', enabled: false, bounds: { x: 784, y: 400, width: 16, height: 100 } },
        ] },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const areas = page.elements.filter((e) => e.scroll)
    // The bars carry the scroll capability by role name; they are not areas.
    expect(areas.map((e) => [e.role, e.label, e.scroll])).toEqual([
      ['scrollarea', 'sidebar starting at AirDrop', { up: false, down: true }],
      ['scrollarea', 'table starting at Applications', { up: true, down: true }],
    ])
    expect(areas.every((e) => e.clickable === false && !e.editable)).toBe(true)
    expect(page.text).not.toContain('starting at')
    expect(page.canScroll).toEqual({ down: true, up: true })
    const space = buildActionSpace({ page, history: [] })
    expect(space.scrollCandidates).toEqual(areas.map((e) => String(e.node)))
    expect(space.clickCandidates).not.toContain(String(areas[0]!.node))
    const request = buildRequest({ goal: 'g', page, space, presets: [], last: undefined, history: [] })
    expect(Object.keys(request.questions.scroll_area!.criteria!)).toEqual([...space.scrollCandidates, 'none_of_these'])
    expect(request.questions.scroll_area!.criteria![space.scrollCandidates[1]!]).toMatchObject({ element: `[${areas[1]!.node}] Scroll table starting at Applications` })
    const act = vi.spyOn(service, 'act')
    await adapter.scrollArea!(areas[1]!.node, 560)
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'scroll', ref: areas[1]!.ref, dy: 560 }], expect.any(Object))
    // A scroll that names no area still goes to the first one found.
    await adapter.observe()
    await adapter.scroll(page, 560)
    expect(act).toHaveBeenLastCalledWith(expect.any(String), [{ type: 'scroll', ref: areas[0]!.ref, dy: 560 }], expect.any(Object))
    // A wheel posted at a list with no scroll bar has no verdict of its own.
    // Eight of them on a list that already fit were each "change unknown", so
    // the no-progress rule never fired; the settle saw nothing move and gets
    // to say so.
    const real = ComputerUseService.prototype.act
    act.mockImplementation(async (...args) => ({ ...(await real.apply(service, args)), outcome: 'unknown', diff: undefined }))
    const before = await adapter.observe()
    await adapter.scrollArea!(areas[1]!.node, 560)
    expect(await adapter.settle(before, { node: areas[1]!.node })).toMatchObject({ changed: false })
    expect(adapter.changed(before, await adapter.observe())).toBe(false)
    // Off the real AX tree the bar's role name grants it the scroll capability too.
    const obs = await service.observe(undefined, 'semantic')
    const outline = axTreeToOutline({ index: 1, role: 'AXScrollArea', bounds: { x: 0, y: 0, width: 600, height: 400 }, children: [
      { index: 2, role: 'AXTable', children: [{ index: 3, role: 'AXRow', children: [{ index: 4, role: 'AXStaticText', value: 'Applications' }] }] },
      { index: 5, role: 'AXScrollBar', value: '0.42', bounds: { x: 584, y: 0, width: 16, height: 400 }, children: [{ index: 6, role: 'AXValueIndicator', value: '0.42' }] },
    ] })
    expect(computerPage({ ...obs, outline }, service).elements.filter((e) => e.scroll).map((e) => e.label)).toEqual(['table starting at Applications'])
  })

  it('offers a text area for append and appends by focusing it, ⌘↓ and keystrokes', async () => {
    // TextEdit's document: type_text replaces the whole body, and a goal that
    // adds a line had no move. A text area is offered for append as well; a
    // single-line field is not, since replacing is what filling a field means.
    const backend = new FakePlatformBackend([{ app: 'TextEdit', bundleId: 'com.test.textedit', pid: 7, windows: [{ title: 'Untitled', focused: true,
      tree: { role: 'window', children: [
        { role: 'textArea', value: 'First line', bounds: { x: 0, y: 0, width: 500, height: 300 } },
        { role: 'textField', name: 'Title', value: '' },
      ] },
    }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'TextEdit', bundleId: 'com.test.textedit', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const body = page.elements.find((e) => e.label === 'First line')!
    expect(body).toMatchObject({ editable: true, appendable: true })
    expect(page.elements.find((e) => e.label === 'Title')!.appendable).toBeUndefined()
    const space = buildActionSpace({ page, history: [] })
    expect(space.appendCandidates).toEqual([String(body.node)])
    expect(space.typeCandidates).toContain(String(body.node))
    const request = buildRequest({ goal: 'g', page, space, presets: [{ key: 'Line', value: '\nSecond line' }], last: undefined, history: [] })
    expect(request.questions.action.criteria).toHaveProperty('append')
    expect(request.questions.append_target!.criteria![String(body.node)]).toMatchObject({ element: `[${body.node}] Append to First line` })
    const act = vi.spyOn(service, 'act')
    await adapter.append!(body.node, '\nSecond line')
    expect(act).toHaveBeenCalledWith(page.stateId, [
      { type: 'click', ref: body.ref },
      { type: 'keypress', keys: ['cmd+down'] },
      { type: 'typeText', text: '\nSecond line' },
    ], expect.not.objectContaining({ expect: expect.anything() }))
    const next = await adapter.observe()
    expect(next.elements.find((e) => e.node === body.node)?.value).toBe('First line\nSecond line')
    expect(adapter.changed(page, next)).toBe(true)
    // Return in the focused document is a newline, not a submit; the live run
    // offered "Press Enter in" the document at 0.78 as its click target.
    const obs = await service.observe(undefined, 'semantic')
    const focused = computerPage({ ...obs, outline: axTreeToOutline({ index: 1, role: 'AXTextArea', value: 'First line', settable: true, appFocused: true, bounds: { x: 0, y: 0, width: 500, height: 300 } }) }, service)
    expect(focused.elements[0]).toMatchObject({ appendable: true, canSubmit: false })
    expect(buildActionSpace({ page: focused, history: [] }).clickCandidates.some((c) => c.startsWith('submit:'))).toBe(false)
    // At click tier there is nothing to type, so nothing to append either.
    const click = new ComputerUseService({ adapter: backend })
    click.policy.setEnabled(true)
    click.policy.grantSession({ app: 'TextEdit', bundleId: 'com.test.textedit', tier: 'click' })
    const observed = await click.observe((await click.resolveTargetRoot()).rootId, 'semantic')
    expect(computerPage(computerObservation(click.getStateStore().get(observed.stateId)!), click).elements.some((e) => e.appendable)).toBe(false)
  })

  it('offers the app\'s other roots as switch targets, switches by re-observing, and presses Escape as a key', async () => {
    // A Fonts panel opened from a document: the run's root moves to the panel
    // (the act's successor), and the document behind it is where the goal may
    // continue. It is offered under `switch`; choosing it re-observes that
    // root, nothing is pressed.
    const backend = new FakePlatformBackend([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7, windows: [{ title: 'Document', tree: {
      role: 'window', children: [{ role: 'button', name: 'Show Fonts', opensModal: { title: 'Fonts', kind: 'window', buttonName: 'Close' } }],
    } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Editor', bundleId: 'com.test.editor', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const document = await adapter.observe()
    expect(document.canEscape).toBe(true)
    expect(document.elements.some((e) => e.root)).toBe(false)
    const space0 = buildActionSpace({ page: document, history: [] })
    expect(space0.switchCandidates).toEqual([])
    expect(Object.keys(buildRequest({ goal: 'g', page: document, space: space0, presets: [], last: undefined, history: [] }).questions.action.criteria!)).toContain('escape')
    await adapter.click(document.elements.find((e) => e.label === 'Show Fonts')!.node)
    const fonts = await adapter.observe()
    expect(fonts.title).toContain('Fonts')
    const back = fonts.elements.find((e) => e.root)!
    expect(back).toMatchObject({ role: 'window', label: 'Document', root: document.rootId, clickable: false, editable: false })
    const space = buildActionSpace({ page: fonts, history: [] })
    expect(space.switchCandidates).toEqual([String(back.node)])
    expect(space.clickCandidates).not.toContain(String(back.node))
    const request = buildRequest({ goal: 'g', page: fonts, space, presets: [], last: undefined, history: [] })
    expect(request.questions.action.criteria).toHaveProperty('switch')
    expect(request.questions.switch_target!.criteria![String(back.node)]).toMatchObject({ element: `[${back.node}] Switch to Document`, role: 'window' })
    // A switch target survives a re-observation under a new index: it is the root it names.
    expect(adapter.sameTarget!(fonts, { ...fonts, elements: [{ ...back, node: 9 }] }, back)).toBe(true)
    const act = vi.spyOn(service, 'act')
    await adapter.switchRoot!(back.root!)
    const again = await adapter.observe()
    expect(act).not.toHaveBeenCalled()
    expect(again.rootId).toBe(document.rootId)
    expect(again.elements.map((e) => e.label)).toContain('Show Fonts')
    expect(again.elements.find((e) => e.root)).toMatchObject({ label: 'Fonts', root: fonts.rootId })
    // Escape is a posted key on the current state.
    await adapter.dismiss!()
    expect(act).toHaveBeenCalledWith(again.stateId, [{ type: 'keypress', keys: ['escape'] }], expect.any(Object))
    // A root that has gone is a stale choice, not a failed run.
    await adapter.observe()
    await expect(adapter.switchRoot!('@r99')).rejects.toBeInstanceOf(StaleObservation)
  })

  it('right-clicks an offered element, lands the next observation on its context menu, and clicks the menu\'s items', async () => {
    // The menu an action opens is read whole and taken down (ContextMenuLedger).
    // The run observes that state without bringing the menu back, must not
    // settle-poll it (each sample would reopen it on screen), and a click on
    // one of its items replays the right-click before pressing.
    const row = (name: string) => ({ role: 'row', selectable: true, children: [{ role: 'cell', openable: true, children: [{ role: 'staticText', value: name }] }] })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'Documents', windowId: 100, tree: {
      role: 'window', children: [
        { role: 'button', name: 'More', opensModal: { title: 'Context', kind: 'menu', text: 'Actions', buttonName: 'Rename' } },
        row('Report.pdf'),
        { ...row('Notes.txt'), selected: true },
      ],
    } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    // One right-click target per node: the row's Select candidate, or its Open one when it is already selected.
    expect(page.elements.filter((e) => e.contextMenu).map((e) => e.label)).toEqual(['More', 'Select Report.pdf', 'Open Notes.txt'])
    const space = buildActionSpace({ page, history: [] })
    const request = buildRequest({ goal: 'g', page, space, presets: [], last: undefined, history: [] })
    expect(request.questions.action.criteria).toHaveProperty('context_menu')
    const report = page.elements.find((e) => e.label === 'Select Report.pdf')!
    expect(request.questions.context_menu_target!.criteria![String(report.node)]).toMatchObject({ element: `[${report.node}] Right-click Report.pdf` })
    const act = vi.spyOn(service, 'act')
    const more = page.elements.find((e) => e.label === 'More')!
    await adapter.contextMenu!(more.node)
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'click', ref: more.ref, button: 'right' }], expect.any(Object))
    expect(await adapter.settle(page, { node: more.node })).toMatchObject({ changed: true, fields: ['menu-root'] })
    const menu = await adapter.observe()
    expect(menu.rootKind).toBe('menu')
    expect(menu.title).toContain('Context')
    expect(adapter.changed(page, menu)).toBe(true)
    // The screen shows no menu while Jev decides; the state still has its items as clicks.
    expect(backend.dismissals).toEqual(['Context'])
    const rename = menu.elements.find((e) => e.label === 'Rename')!
    expect(buildActionSpace({ page: menu, history: [] }).clickCandidates).toContain(String(rename.node))
    // And the window behind it is a switch target, the way back without choosing an item.
    expect(menu.elements.find((e) => e.root)).toMatchObject({ label: 'Documents', root: page.rootId })
    await adapter.click(rename.node)
    expect(act).toHaveBeenLastCalledWith(menu.stateId, [{ type: 'press', ref: rename.ref }], expect.any(Object))
    expect(backend.dismissals).toEqual(['Context', 'Context'])
  })

  it('captures a fused snapshot for a pause: path only, aligned to a state the caller can act on', async () => {
    const { service } = fixture()
    const persist = vi.spyOn(screenshotStore, 'persistComputerUseScreenshot').mockReturnValue({ path: '/zone/shot.jpg', mimeType: 'image/jpeg', width: 400, height: 300 } as never)
    try {
      const withSession = createComputerAdapter({ service, ask: vi.fn(), sessionId: 'sess', resolve: async () => (await service.resolveTargetRoot()).rootId })
      await withSession.resolveTarget()
      const page = await withSession.observe()
      const capture = await withSession.capture!()
      expect(capture).toMatchObject({ stateId: expect.any(String), image: { path: '/zone/shot.jpg', width: 400, height: 300 }, coordinateSpace: expect.objectContaining({ width: expect.any(Number) }) })
      expect(capture!.stateId).not.toBe(page.stateId)
      expect(service.getStateStore().get(capture!.stateId!)?.image).toMatchObject({ path: '/zone/shot.jpg', width: 400, height: 300 })
      expect(persist).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Object), { sessionId: 'sess' })
      // The paused page is still fresh: an observation claims no write.
      expect(await withSession.isFresh(page)).toBe(true)
      // Without a session there is nowhere to write the picture to.
      const anonymous = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
      await anonymous.resolveTarget()
      expect(await anonymous.capture!()).toBeNull()
    } finally {
      persist.mockRestore()
    }
  })

  it('offers a drag only for selected items, onto folders and container-list rows, center to center', async () => {
    // Finder: Report.pdf selected in the list, Projects a folder beside it, the
    // sidebar an outline named "sidebar". The selected row moves; folders and
    // sidebar rows are where it can go; another file is not.
    const row = (name: string, itemKind: 'folder' | 'file', bounds: { x: number; y: number; width: number; height: number }, selected = false) => ({
      role: 'row', selectable: true, selected, bounds, children: [{ role: 'cell', openable: true, bounds, children: [{ role: 'textField', name: '', value: name, openable: true, itemKind, bounds }] }],
    })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'Documents', tree: { role: 'window', children: [
      { role: 'scrollArea', bounds: { x: 0, y: 0, width: 200, height: 400 }, children: [{ role: 'outline', name: 'sidebar', children: [
        { role: 'row', selectable: true, bounds: { x: 0, y: 10, width: 200, height: 20 }, children: [{ role: 'staticText', value: 'Desktop' }] },
      ] }] },
      { role: 'scrollArea', bounds: { x: 200, y: 0, width: 600, height: 400 }, children: [{ role: 'outline', name: 'list view', children: [
        row('Report.pdf', 'file', { x: 200, y: 10, width: 600, height: 20 }, true),
        row('Notes.txt', 'file', { x: 200, y: 30, width: 600, height: 20 }),
        row('Projects', 'folder', { x: 200, y: 50, width: 600, height: 20 }),
      ] }] },
    ] } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const source = page.elements.find((e) => e.dragSource)!
    expect(source).toMatchObject({ role: 'row', label: 'Report.pdf', value: 'selected', clickable: false })
    // One drop target per item, whichever of its nodes carries the folder metadata (the fake keeps it on the name field).
    expect(page.elements.filter((e) => e.dropTarget).map((e) => e.label)).toEqual(['Select Desktop', 'Projects'])
    const space = buildActionSpace({ page, history: [] })
    expect(space.dragSources).toEqual([String(source.node)])
    expect(space.clickCandidates).not.toContain(String(source.node))
    const request = buildRequest({ goal: 'g', page, space, presets: [], last: undefined, history: [] })
    expect(request.questions.action.criteria).toHaveProperty('drag')
    const projects = page.elements.find((e) => e.dropTarget && e.label === 'Projects')!
    expect(request.questions.drag_target_for_Report_pdf!.criteria![String(projects.node)]).toMatchObject({ element: `[${projects.node}] Drop onto Projects` })
    const act = vi.spyOn(service, 'act')
    await adapter.drag!(source.node, projects.node)
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'drag', path: [{ x: 500, y: 20 }, { x: 500, y: 60 }] }], expect.any(Object))
    // Nothing selected: no source, no drag, no heads.
    const none = computerPage({ ...(await service.observe(undefined, 'semantic')), outline: axTreeToOutline({ index: 1, role: 'AXRow', actions: [], bounds: { x: 0, y: 0, width: 100, height: 20 }, children: [{ index: 2, role: 'AXTextField', value: 'Projects', itemKind: 'folder' as const, actions: ['AXOpen'], bounds: { x: 0, y: 0, width: 100, height: 20 } }] }) }, service)
    const empty = buildActionSpace({ page: none, history: [] })
    expect(empty.dragSources).toEqual([])
    expect(Object.keys(buildRequest({ goal: 'g', page: none, space: empty, presets: [], last: undefined, history: [] }).questions).some((k) => k.startsWith('drag_target_for_'))).toBe(false)
  })

  it('ends the content with state sentences a goal about the end state can match, ahead of the menus', async () => {
    // Four runs reached their goal and read goal_satisfied 0.2–0.5: the
    // achieved state — a sheet gone, a line appended, an icon moved — was
    // not a sentence anywhere in the text. The window line says which root
    // this is and whether a sheet is over it; a text area says what it ends
    // with; an icon says where it sits. Menus come after, so a text budget
    // cuts commands before it cuts state.
    const backend = new FakePlatformBackend([{ app: 'TextEdit', bundleId: 'com.test.textedit', pid: 7,
      menuBar: { role: 'menuBar', children: [{ role: 'menuBarItem', name: 'File', children: [{ role: 'menuItem', name: 'Save…' }] }] },
      windows: [{ title: 'Untitled', focused: true, tree: { role: 'window', children: [
        { role: 'scrollArea', bounds: { x: 0, y: 0, width: 586, height: 420 }, children: [
          { role: 'textArea', value: 'Jev sheet benchmark\nAppended by Jev\n', bounds: { x: 0, y: 0, width: 560, height: 400 } },
        ] },
        { role: 'button', name: 'Save', opensModal: { title: 'Save', kind: 'sheet', buttonName: 'Cancel' } },
      ] } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'TextEdit', bundleId: 'com.test.textedit', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const document = await adapter.observe()
    const lines = document.text.split('\n')
    expect(lines[0]).toBe('(observing: TextEdit window "Untitled"; no sheet or dialog open)')
    expect(lines).toContain('(text area "Jev sheet benchmark": ends with "Appended by Jev")')
    // Content, then state, then menus.
    expect(lines.indexOf('(text area "Jev sheet benchmark": ends with "Appended by Jev")')).toBeGreaterThan(lines.indexOf('Save'))
    expect(lines.indexOf('Save…')).toBeGreaterThan(lines.indexOf('(text area "Jev sheet benchmark": ends with "Appended by Jev")'))
    // On the sheet, the line names the window it stands in front of.
    await adapter.click(document.elements.find((e) => e.label === 'Save')!.node)
    const sheet = await adapter.observe()
    expect(sheet.text.split('\n')[0]).toBe('(observing: TextEdit sheet "Save" in front of window "Untitled")')
  })

  it('says where an icon sits in an icon view, as a share of the visible area', async () => {
    // Finder's icon view: the icon is a named image with Open, inside a nameless cell list.
    const icon = (name: string, x: number, y: number) => ({ role: 'list', bounds: { x: x - 24, y: y - 24, width: 112, height: 112 }, children: [{ role: 'image', name, openable: true, bounds: { x, y, width: 64, height: 64 } }] })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'bench', tree: { role: 'window', children: [
      { role: 'scrollArea', bounds: { x: 100, y: 100, width: 800, height: 400 }, children: [
        { role: 'list', name: 'icon view', bounds: { x: 100, y: 100, width: 800, height: 1200 }, children: [icon('Note.txt', 668, 348), icon('Draft.txt', 108, 108)] },
      ] },
    ] } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const page = computerPage(await service.observe(undefined, 'semantic'), service)
    expect(page.text).toContain('(Note.txt: at 75%,70% of icon view, left to right and top to bottom)')
    expect(page.text).toContain('(Draft.txt: at 5%,10% of icon view, left to right and top to bottom)')
  })

  it('says which expanded row a nested outline row is inside', async () => {
    // Finder's list view after a move into an expanded folder: the file is the
    // row under the folder, one level deeper. Read flat it was the page before
    // the move; the depth names the folder.
    const row = (name: string, extra: Record<string, unknown> = {}) => ({
      role: 'row', selectable: true, bounds: { x: 0, y: 10, width: 600, height: 20 }, ...extra,
      children: [{ role: 'cell', openable: true, bounds: { x: 0, y: 10, width: 600, height: 20 }, children: [{ role: 'textField', name: '', value: name, openable: true, bounds: { x: 0, y: 10, width: 600, height: 20 } }] }],
    })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'bench', tree: { role: 'window', children: [{ role: 'outline', name: 'list view', children: [
      row('Archive'), row('Report.txt', { level: 1, selected: true }), row('Notes.txt'),
    ] }] } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const page = computerPage(await service.observe(undefined, 'semantic'), service)
    expect(page.text).toContain('(Report.txt: selected, inside Archive)')
    expect(page.text).not.toContain('Notes.txt: ')
    // Labels stay the item's own name: the drag head key is derived from it.
    expect(page.elements.find((e) => e.dragSource)?.label).toBe('Report.txt')
  })

  it('lists a picture for the hand_target head, keeps menu commands out of it, and runs handed actions through the service', async () => {
    // Preview: an image with no actions of its own, a caption field, and the
    // menu bar. The picture is named in the text and offered to nothing but the
    // hand-over; a menu command is not somewhere an input could land.
    const backend = new FakePlatformBackend([{ app: 'Preview', bundleId: 'com.test.preview', pid: 9,
      menuBar: { role: 'menuBar', children: [{ role: 'menuBarItem', name: 'File', children: [{ role: 'menuItem', name: 'Export…' }, { role: 'menuItem', name: 'Crop', enabled: false }] }] },
      windows: [{ title: 'photo.jpg', tree: { role: 'window', children: [
        { role: 'image', name: 'photo.jpg', bounds: { x: 0, y: 40, width: 400, height: 300 } },
        { role: 'textField', name: 'Caption', value: '', bounds: { x: 0, y: 350, width: 400, height: 24 } },
      ] } }] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Preview', bundleId: 'com.test.preview', tier: 'full' })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    const picture = page.elements.find((e) => e.picture)!
    expect(picture).toMatchObject({ role: 'image', label: 'photo.jpg', clickable: false, bounds: { x: 0, y: 40, width: 400, height: 300 } })
    expect(page.text).toContain('(picture-only: photo.jpg)')
    const command = page.elements.find((e) => e.label === 'File ▸ Export…')!
    expect(command.menuCommand).toBe(true)
    // A disabled command is not offered, and the text says it is disabled.
    expect(page.elements.some((e) => e.label === 'File ▸ Crop')).toBe(false)
    expect(page.text).toContain('Crop (disabled)')
    const space = buildActionSpace({ page, history: [] })
    expect(space.handCandidates).toContain(String(picture.node))
    expect(space.handCandidates).not.toContain(String(command.node))
    expect(space.clickCandidates).not.toContain(String(picture.node))
    const request = buildRequest({ goal: 'g', page, space, presets: [], last: undefined, history: [] })
    expect(request.questions.action.criteria).toHaveProperty('needs_input')
    expect(request.questions.hand_target!.criteria![String(picture.node)]).toMatchObject({ element: `[${picture.node}] Hand over input for photo.jpg` })
    expect(request.questions.input_kind!.criteria).toHaveProperty('position')
    // Handed actions go to the service as a computer_act batch on the current state.
    const act = vi.spyOn(service, 'act')
    await adapter.act!(page, [{ type: 'click', x: 120, y: 160 }])
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'click', x: 120, y: 160 }], expect.any(Object))
    // A handed drag's end point is a drop point: the host lowers its own window over it, as for the loop's drags.
    backend.coverWindow(9, 'photo.jpg', { windowId: 301, pid: 4242, app: 'SuperOne' }, { x: 300, y: 300, width: 100, height: 100 })
    const lowered: number[][] = []
    const lower = vi.fn((ids: number[]) => { lowered.push(ids); for (const id of ids) backend.uncover(id); return () => {} })
    const hosted = createComputerAdapter({ service, ask: vi.fn(), ownWindows: { pid: 4242, lower }, resolve: async () => (await service.resolveTargetRoot()).rootId })
    await hosted.resolveTarget()
    const hostedPage = await hosted.observe()
    await hosted.act!(hostedPage, [{ type: 'drag', path: [{ x: 50, y: 60 }, { x: 350, y: 340 }] }])
    expect(lowered).toEqual([[301]])
    expect(act).toHaveBeenLastCalledWith(hostedPage.stateId, [{ type: 'drag', path: [{ x: 50, y: 60 }, { x: 350, y: 340 }] }], expect.any(Object))
  })

  it('keeps a covered drop target on offer, notes the cover, and lowers the host out of the way of one it covers itself', async () => {
    // A drop is delivered to the frontmost window at the drop point (§11.8).
    // Projects' row sits under another app's window: still offered — the
    // platform activates Finder around that drag — and the text says so.
    // Desktop's sidebar row sits under the host's own window: offered, and
    // the drag lowers that window for its duration only.
    const row = (name: string, itemKind: 'folder' | 'file', bounds: { x: number; y: number; width: number; height: number }, selected = false) => ({
      role: 'row', selectable: true, selected, bounds, children: [{ role: 'cell', openable: true, bounds, children: [{ role: 'textField', name: '', value: name, openable: true, itemKind, bounds }] }],
    })
    const backend = new FakePlatformBackend([{ app: 'Finder', bundleId: 'com.test.finder', pid: 7, windows: [{ title: 'Documents', tree: { role: 'window', children: [
      { role: 'scrollArea', bounds: { x: 0, y: 0, width: 200, height: 400 }, children: [{ role: 'outline', name: 'sidebar', children: [
        { role: 'row', selectable: true, bounds: { x: 0, y: 10, width: 200, height: 20 }, children: [{ role: 'staticText', value: 'Desktop' }] },
      ] }] },
      { role: 'scrollArea', bounds: { x: 200, y: 0, width: 600, height: 400 }, children: [{ role: 'outline', name: 'list view', children: [
        row('Report.pdf', 'file', { x: 200, y: 10, width: 600, height: 20 }, true),
        row('Projects', 'folder', { x: 200, y: 50, width: 600, height: 20 }),
      ] }] },
    ] } }] }])
    backend.coverWindow(7, 'Documents', { windowId: 901, pid: 55, app: 'TextEdit' }, { x: 200, y: 40, width: 600, height: 40 })
    backend.coverWindow(7, 'Documents', { windowId: 301, pid: 4242, app: 'SuperOne' }, { x: 0, y: 0, width: 200, height: 400 })
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    service.policy.grantSession({ app: 'Finder', bundleId: 'com.test.finder', tier: 'full' })
    const lowered: number[][] = []
    let restored = 0
    const lower = vi.fn((ids: number[]) => { lowered.push(ids); for (const id of ids) backend.uncover(id); return () => { restored++ } })
    const adapter = createComputerAdapter({ service, ask: vi.fn(), ownWindows: { pid: 4242, lower }, resolve: async () => (await service.resolveTargetRoot()).rootId })
    await adapter.resolveTarget()
    const page = await adapter.observe()
    expect(page.elements.filter((e) => e.dropTarget).map((e) => e.label)).toEqual(['Select Desktop', 'Projects'])
    expect(page.text).toContain('(Projects: drop point covered by TextEdit)')
    expect(page.text).not.toContain('SuperOne')
    const space = buildActionSpace({ page, history: [] })
    const desktop = page.elements.find((e) => e.label === 'Select Desktop')!
    const projects = page.elements.find((e) => e.label === 'Projects')!
    expect(space.dropTargets).toEqual([String(desktop.node), String(projects.node)])
    const source = page.elements.find((e) => e.dragSource)!
    const act = vi.spyOn(service, 'act')
    await adapter.drag!(source.node, desktop.node)
    // Lowered before the drag, on the drop point's cover only; restored after.
    expect(lowered).toEqual([[301]])
    expect(act).toHaveBeenCalledWith(page.stateId, [{ type: 'drag', path: [{ x: 500, y: 20 }, { x: 100, y: 20 }] }], expect.any(Object))
    expect(lower.mock.invocationCallOrder[0]!).toBeLessThan(act.mock.invocationCallOrder[0]!)
    expect(restored).toBe(1)
    // A third-party cover is the platform's to deal with: nothing is lowered.
    const after = await adapter.observe()
    await adapter.drag!(after.elements.find((e) => e.dragSource)!.node, after.elements.find((e) => e.label === 'Projects')!.node)
    expect(lowered).toEqual([[301]])
    // Without a host that can lower itself, its own window is noted like any other; the target stays offered.
    backend.coverWindow(7, 'Documents', { windowId: 301, pid: 4242, app: 'SuperOne' }, { x: 0, y: 0, width: 200, height: 400 })
    const plain = createComputerAdapter({ service, ask: vi.fn(), resolve: async () => (await service.resolveTargetRoot()).rootId })
    await plain.resolveTarget()
    const unaided = await plain.observe()
    expect(unaided.elements.filter((e) => e.dropTarget)).toHaveLength(2)
    expect(unaided.text).toContain('(Desktop: drop point covered by SuperOne)')
  })
})
