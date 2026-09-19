import { describe, expect, it, vi } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentSession } from '../device-agent/execute'
import { FakeDeviceBackend } from '../device-agent/fake-backend.test-support'
import { DeviceAgentError } from '../device-agent/types'
import { createDeviceAdapter, devicePage } from './device-page'
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
    expect(backend.performed).toEqual([{ kind: 'tap', x: 0.5, y: 0.35 }])
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
    expect(resumed.since_last).toContain('Page changed while paused; answer discarded')
  })

  it('reuses an answered target only when the re-observed tree is identical', async () => {
    const { adapter, backend, ask } = fixture([initial, initial, final])
    ask.mockImplementation(async (req) => ({ answers: { goal_satisfied: noul(0), still_loading: noul(0), action: pick('none_useful', Object.keys(req.questions.action.criteria!)) }, model: 'test', usage: {}, latencyMs: 1 }))
    const run = new FastRun({ ...opts, hasDoneWhen: true }, adapter)
    const paused = await run.start()
    expect((await run.resume({ questionId: paused.question!.id, choice: '2' })).status).toBe('done')
    expect(backend.observations).toHaveLength(3)
    expect(backend.addressed[0]).toBe(backend.observations[1])
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

  it('never requests control and refuses input if the held grant was lost', async () => {
    const { adapter, assertControl, backend } = fixture()
    await adapter.resolveTarget()
    await adapter.observe()
    assertControl.mockImplementation(() => { throw new DeviceAgentError('NO_DEVICE', 'Use device_request_control') })
    await expect(adapter.click(1)).rejects.toMatchObject({ code: 'NO_DEVICE' })
    expect(backend.performed).toHaveLength(0)
  })
})
