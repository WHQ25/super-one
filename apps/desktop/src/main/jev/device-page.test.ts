import { describe, expect, it, vi } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentSession } from '../device-agent/execute'
import { FakeDeviceBackend } from '../device-agent/fake-backend.test-support'
import { DeviceAgentError } from '../device-agent/types'
import { createDeviceAdapter, devicePage, DEVICE_WORDS } from './device-page'
import { FastRun } from './loop'
import { noul, pick } from './test-fixtures'
import type { JevRequest } from './typesafe-client'

const node = (ref: string, label: string, role = 'button', extra: Partial<DeviceUiNode> = {}): DeviceUiNode => ({ ref, role, label, bounds: [0.1, 0.3, 0.8, 0.1], ...extra })
const screen = (children: DeviceUiNode[]): DeviceUiNode => ({ ref: '@e0', role: 'application', bounds: [0, 0, 1, 1], children })
const initial = screen([node('@e1', 'Next'), node('@e2', 'Publish')])
const final = screen([node('@e1', 'Completed', 'text')])
const opts = { goal: 'Open the completed page', presets: [], allow: [], avoid: [], maxSteps: 5, maxWallMs: 45000 }
function fixture(screens: DeviceUiNode[] = [initial, final]) {
  const backend = new FakeDeviceBackend(screens)
  const session = new DeviceAgentSession(backend)
  const assertControl = vi.fn()
  const ask = vi.fn(async (req: JevRequest) => ({ answers: {
    goal_satisfied: noul(0), still_loading: noul(0), action: pick('click', Object.keys(req.questions.action.criteria!)),
    click_target: pick('1', Object.keys(req.questions.click_target.criteria!)),
  }, model: 'test', usage: {}, latencyMs: 1 }))
  const adapter = createDeviceAdapter({ deviceId: 'fake-phone', session, ask, assertControl, doneWhen: { kind: 'exists', label: 'Completed' } })
  adapter.trace = () => {}
  return { backend, session, ask, adapter, assertControl }
}

describe('device fast-loop adapter', () => {
  it('runs a safe tap and checks the successor condition without an extra snapshot or model call', async () => {
    const { adapter, ask, backend } = fixture()
    const done = await new FastRun({ ...opts, hasDoneWhen: true }, adapter).start()
    expect(done.status).toBe('done')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(backend.observations).toHaveLength(2)
    expect(backend.performed).toEqual([{ kind: 'press', ref: '@e1' }])
    expect(backend.addressed[0]).toBe(backend.observations[0])
  })

  it('answers a wait itself, because its changed() reports the last action, not the screen', async () => {
    // The loop's fallback decides by calling changed(before, after) on a fresh
    // observation — but that verdict only exists on an act's successor, so the
    // fallback could never see a screen settle and every wait burned its cap.
    const { adapter, session } = fixture([initial, final])
    expect(adapter.waitForChange).toBeDefined()
    const before = await adapter.observe()
    expect(adapter.changed(before, before)).toBeNull()

    // The next read is a different screen, so waiting resolves at once.
    await session.observeForRun()
    await expect(adapter.waitForChange!(before, 1000)).resolves.toBe(true)
  })

  it('requires the current snapshot before every action', async () => {
    const { adapter, session, backend } = fixture([initial, initial])
    await adapter.resolveTarget()
    const page = await adapter.observe()
    await session.snapshot({})
    expect(await adapter.isFresh(page)).toBe(false)
    await expect(adapter.click(1)).rejects.toThrow('superseded')
    expect(backend.performed).toHaveLength(0)
  })

  it('always re-observes on resume and discards a positional ref that now names another control', async () => {
    const { adapter, backend, ask } = fixture([initial, screen([node('@e2', 'Delete'), node('@e3', 'Publish')])])
    ask.mockImplementation(async (req) => ({ answers: { goal_satisfied: noul(0), still_loading: noul(0), action: pick('none_useful', Object.keys(req.questions.action.criteria!)) }, model: 'test', usage: {}, latencyMs: 1 }))
    const run = new FastRun(opts, adapter)
    const paused = await run.start()
    const resumed = await run.resume({ questionId: paused.question!.id, choice: '2' })
    expect(backend.observations.length).toBeGreaterThanOrEqual(2)
    expect(backend.performed).toHaveLength(0)
    expect(resumed.progress.note).toBe('Page changed while paused; answer discarded')
  })

  it('reuses an answered target only when the re-observed tree is identical', async () => {
    // The pause itself reads the screen once more, for the picture it returns.
    const { adapter, backend, ask } = fixture([initial, initial, initial, final])
    ask.mockImplementation(async (req) => ({ answers: { goal_satisfied: noul(0), still_loading: noul(0), action: pick('none_useful', Object.keys(req.questions.action.criteria!)) }, model: 'test', usage: {}, latencyMs: 1 }))
    const run = new FastRun({ ...opts, hasDoneWhen: true }, adapter)
    const paused = await run.start()
    expect(paused.snapshot?.image).toMatchObject({ path: expect.any(String), relevance: 'optional' })
    expect((await run.resume({ questionId: paused.question!.id, choice: '2' })).status).toBe('done')
    expect(backend.observations).toHaveLength(4)
    expect(backend.addressed[0]).toBe(backend.observations[2])
  })

  it('pauses before Jev on treeUnavailable or an OCR-only screen', async () => {
    const { adapter, backend, ask } = fixture([screen([node('@e1', 'Pay', 'text', { source: 'ocr' })])])
    const result = await new FastRun(opts, adapter).start()
    expect(result.question).toMatchObject({ reason: 'no-progress' })
    expect(ask).not.toHaveBeenCalled()
    expect(backend.performed).toHaveLength(0)
    const observation = await backend.observe()
    const page = devicePage({ stateId: 's0', observation: { ...observation, treeUnavailable: true }, createdAt: 0 }, 'fake')
    expect(page.blocked?.why).toContain('accessibility tree')
  })

  it('focuses before replace-text through the existing executor', async () => {
    const field = screen([node('@e1', 'Search', 'textfield', { value: 'old' })])
    const { adapter, backend } = fixture([field, field])
    await adapter.resolveTarget()
    await adapter.observe()
    await adapter.type(1, 'new')
    expect(backend.performed.map((a) => a.kind)).toEqual(['tap', 'setText'])
    expect(backend.performed[1]).toEqual({ kind: 'setText', text: 'new' })
  })

  it('filters secure, disabled and offscreen targets and does not offer keyboard submit', async () => {
    const { adapter } = fixture([screen([
      node('@e1', 'Secret', 'textfield', { secure: true, value: 'never-export' }),
      node('@e2', 'Disabled', 'button', { enabled: false }),
      node('@e3', 'Offscreen', 'button', { bounds: [0, 2, 1, 1] }),
      node('@e4', 'Search', 'textfield', { value: 'filled' }),
    ])])
    await adapter.resolveTarget()
    const page = await adapter.observe()
    expect(page.elements.map((e) => e.label)).toEqual(['Search'])
    expect(page.text).not.toContain('never-export')
    expect(page.elements[0].canSubmit).toBe(false)
  })

  it('writes the screen, its fields and its switches as state sentences the way the iOS bridge reports them', () => {
    // Shaped like a real Settings ▸ Keyboards dump: the list is a plain group,
    // a switch is a checkbox valued "1"/"0", the title is the heading at the top.
    const rows = [
      node('@e4', 'Keyboards, 3', 'button', { bounds: [0.045, 0.14, 0.909, 0.055] }),
      node('@e5', 'Text Replacement', 'button', { bounds: [0.045, 0.23, 0.909, 0.055] }),
      node('@e7', 'Character Preview', 'checkbox', { value: '1', bounds: [0.091, 0.39, 0.818, 0.029] }),
      node('@e8', 'Haptic Feedback', 'checkbox', { value: '0', bounds: [0.091, 0.45, 0.818, 0.029] }),
      node('@e10', 'Hardware Keyboard', 'button', { bounds: [0.045, 0.546, 0.909, 0.055] }),
      node('@e12', 'Auto-Correction', 'checkbox', { value: '1', bounds: [0.091, 0.68, 0.818, 0.029] }),
      node('@e9', 'Search', 'textfield', { value: 'om', focused: true, bounds: [0.075, 0.93, 0.85, 0.04] }),
    ]
    const page = devicePage({ stateId: 's0', createdAt: 0, observation: { orientation: 'portrait', screen: { width: 1320, height: 2868 }, settled: true, root: {
      ref: '@e0', role: 'application', label: 'Settings', bounds: [0, 0, 1, 1], children: [
        node('@e1', 'General', 'button', { identifier: 'BackButton', bounds: [0.045, 0.065, 0.1, 0.046] }),
        node('@e2', 'Keyboards', 'heading', { bounds: [0.4, 0.077, 0.19, 0.022] }),
        { ref: '@e3', role: 'group', bounds: [0, 0, 1, 1], children: rows },
      ] } } }, 'ios-sim:ABC')
    const lines = page.text.split('\n')
    expect(lines[0]).toBe('(observing: Settings screen "Keyboards"; no alert or sheet open)')
    expect(lines[1]).toBe('(text field "Search": focused, holds "om")')
    expect(lines).toContain('Character Preview: on')
    expect(lines).toContain('Haptic Feedback: off')
    expect(page.title).toBe('Keyboards')
    // The group of rows is the list: one scroll area, offered both ways since no row sticks out.
    const area = page.elements.find((e) => e.scroll)
    expect(area).toMatchObject({ role: 'scrollarea', scroll: { up: true, down: true } })
    expect(page.scrollRef).toBe('@e3')
    expect(page.canScroll).toEqual({ down: true, up: true })
    expect(page.canEscape).toBe(true)
    expect(page.elements.find((e) => e.label === 'Character Preview')).toMatchObject({ checked: 'true', bounds: { x: 0.091, y: 0.39, width: 0.818, height: 0.029 } })
    // A row of the list can be long-pressed; the bar's back button and a switch cannot.
    expect(page.elements.find((e) => e.label === 'Text Replacement')?.contextMenu).toBe(true)
    expect(page.elements.find((e) => e.label === 'General')?.contextMenu).toBeUndefined()
    expect(page.elements.find((e) => e.label === 'Character Preview')?.contextMenu).toBeUndefined()
  })

  it('reads the title off a navigation bar the bridge names only by identifier, not off a section index', () => {
    // Settings ▸ Keyboards ▸ Text Replacement: the bar is `group #Text Replacement`, the first heading is the "O" index.
    const page = devicePage({ stateId: 's0', createdAt: 0, observation: { orientation: 'portrait', screen: { width: 1320, height: 2868 }, settled: true, root: {
      ref: '@e0', role: 'application', label: 'Settings', bounds: [0, 0, 1, 1], children: [
        { ref: '@e1', role: 'group', identifier: 'Text Replacement', bounds: [0, 0.065, 1, 0.057] },
        { ref: '@e2', role: 'group', bounds: [0, 0, 1, 1], children: [node('@e4', 'O', 'heading', { bounds: [0, 0.144, 0.966, 0.029] }), node('@e5', 'omw, On my way!', 'statictext', { bounds: [0, 0.174, 1, 0.054] })] },
      ] } } }, 'ios-sim:ABC')
    expect(page.title).toBe('Text Replacement')
    expect(page.text.split('\n')[0]).toBe('(observing: Settings screen "Text Replacement"; no alert or sheet open)')
  })

  it('names an Android row by the texts inside it and offers the innermost list as the scroll area', () => {
    // Shaped like a real Settings dump: nameless clickable rows whose title and
    // summary are text children, nested inside three scroll containers.
    const row = (ref: string, title: string, summary: string, y: number): DeviceUiNode => ({ ref, role: 'button', bounds: [0, y, 1, 0.08], children: [
      { ref: `${ref}i`, role: 'image', identifier: 'android:id/icon', bounds: [0.078, y + 0.018, 0.097, 0.044] },
      { ref: `${ref}t`, role: 'group', bounds: [0.2, y, 0.7, 0.08], children: [
        { ref: `${ref}a`, role: 'text', label: title, identifier: 'android:id/title', bounds: [0.2, y + 0.017, 0.3, 0.024] },
        { ref: `${ref}b`, role: 'text', label: summary, identifier: 'android:id/summary', bounds: [0.2, y + 0.04, 0.3, 0.021] },
      ] },
    ] })
    const page = devicePage({ stateId: 's0', createdAt: 0, observation: { orientation: 'portrait', screen: { width: 1080, height: 2400 }, settled: true, root: {
      ref: '@e0', role: 'group', bounds: [0, 0, 1, 1], children: [
        { ref: '@e3', role: 'scrollview', identifier: 'com.android.settings:id/content_parent', bounds: [0, 0.026, 1, 0.948], children: [
          { ref: '@e5', role: 'group', label: 'Network & internet', identifier: 'com.android.settings:id/collapsing_toolbar', bounds: [0, 0.026, 1, 0.061], children: [
            node('@e7', 'Navigate up', 'button', { bounds: [0.019, 0.026, 0.136, 0.061] }),
          ] },
          { ref: '@e14', role: 'list', identifier: 'com.android.settings:id/recycler_view', bounds: [0, 0.087, 1, 0.886], children: [
            row('@e15', 'Internet', 'AndroidWifi', 0.087),
            row('@e21', 'SIMs', 'T-Mobile', 0.17),
            { ref: '@e27', role: 'button', bounds: [0, 0.252, 1, 0.079], children: [
              { ref: '@e31', role: 'text', label: 'Airplane mode', bounds: [0.2, 0.279, 0.25, 0.024] },
              { ref: '@e33', role: 'switch', value: 'unchecked', bounds: [0.795, 0.265, 0.127, 0.052] },
            ] },
            row('@e76', 'Storage', '54% used', 0.996),
          ] },
        ] },
        { ref: '@e90', role: 'image', label: 'Map of the area', bounds: [0, 0.5, 1, 0.3] },
      ] } } }, 'android:avd:Medium_Phone_API_36.1')
    const lines = page.text.split('\n')
    expect(lines[0]).toBe('(observing: screen "Network & internet"; no alert or sheet open)')
    expect(lines).toContain('(picture-only: Map of the area)')
    expect(lines).toContain('Internet AndroidWifi')
    // The row's texts named it; they are not repeated as lines of their own.
    expect(lines.filter((l) => l === 'Internet')).toHaveLength(0)
    const labels = page.elements.map((e) => `${e.role}:${e.label}`)
    expect(labels).toEqual(['button:Navigate up', 'scrollarea:recycler view', 'button:Internet', 'button:SIMs', 'button:Airplane mode', 'switch:Airplane mode', 'button:Storage', 'image:Map of the area'])
    expect(page.elements.find((e) => e.label === 'Internet')).toMatchObject({ value: 'AndroidWifi', contextMenu: true })
    expect(page.elements.find((e) => e.role === 'switch')).toMatchObject({ checked: 'false', value: 'off' })
    expect(lines).toContain('Airplane mode: off')
    expect(page.elements.find((e) => e.picture)).toMatchObject({ clickable: false, bounds: { x: 0, y: 0.5, width: 1, height: 0.3 } })
    // Only the recycler view is offered: the scrollview around it holds it. The last row sticks out below.
    expect(page.elements.filter((e) => e.scroll)).toHaveLength(1)
    expect(page.elements.find((e) => e.scroll)?.scroll).toEqual({ up: false, down: true })
    expect(page.canScroll).toEqual({ down: true, up: false })
  })

  it('goes back with the platform\'s own gesture, long-presses an item and swipes the chosen scroll area', async () => {
    const list = screen([{ ref: '@e1', role: 'table', bounds: [0, 0.1, 1, 0.8], children: [node('@e2', 'Photo', 'cell'), node('@e3', 'Note', 'cell', { bounds: [0.1, 0.5, 0.8, 0.1] }), node('@e4', 'Other', 'cell', { bounds: [0.1, 0.8, 0.8, 0.1] })] }])
    const ios = fixture([list, list, list, list])
    await ios.adapter.resolveTarget()
    const page = await ios.adapter.observe()
    expect(page.elements.map((e) => e.role)).toEqual(['scrollarea', 'cell', 'cell', 'cell'])
    expect(ios.adapter.words).toBe(DEVICE_WORDS)
    await ios.adapter.dismiss!()
    expect(ios.backend.performed[0]).toMatchObject({ kind: 'swipe', fromX: 0.005, toX: 0.7 })
    await ios.adapter.observe()
    await ios.adapter.contextMenu!(2)
    expect(ios.backend.performed[1]).toMatchObject({ kind: 'longPress', x: 0.5 })
    await ios.adapter.observe()
    await ios.adapter.scrollArea!(1, 100)
    expect(ios.backend.performed[2]).toMatchObject({ kind: 'swipe', fromX: 0.5, fromY: expect.any(Number) })

    const backend = new FakeDeviceBackend([list])
    const session = new DeviceAgentSession(backend)
    const android = createDeviceAdapter({ deviceId: 'android:avd:Pixel', session, ask: vi.fn(), assertControl: vi.fn() })
    await android.resolveTarget()
    await android.observe()
    await android.dismiss!()
    expect(backend.performed[0]).toEqual({ kind: 'key', button: 'back' })
  })

  it('never requests control and refuses input if the held grant was lost', async () => {
    const { adapter, assertControl, backend } = fixture()
    await adapter.resolveTarget()
    await adapter.observe()
    assertControl.mockImplementation(() => { throw new DeviceAgentError('NO_DEVICE', 'Use device_request_control') })
    await expect(adapter.click(1)).rejects.toMatchObject({ code: 'NO_DEVICE' })
    expect(backend.performed).toHaveLength(0)
  })
})
