import { describe, expect, it } from 'vitest'
import {
  deviceInputSummary,
  deviceNeedsAttention,
  deviceVerbKey,
  formatDeviceCondition,
  getDeviceOp,
  parseDeviceResult,
} from './device-tool-display'

describe('device tool op routing', () => {
  it('claims the four device tools and nothing that merely starts the same way', () => {
    expect(getDeviceOp('device_snapshot')).toBe('snapshot')
    expect(getDeviceOp('device_wait_for')).toBe('wait_for')
    // A future `device_*` tool must not silently inherit this family's row.
    expect(getDeviceOp('device_install_app')).toBeNull()
    expect(getDeviceOp('computer_snapshot')).toBeNull()
  })
})

describe('device tool header verbs', () => {
  it('names the single action so the row says what the agent actually did', () => {
    const verb = (type: string, extra: Record<string, unknown> = {}) =>
      deviceVerbKey('act', { actions: [{ type, ...extra }] })

    expect(verb('tap')).toBe('tap')
    expect(verb('swipe')).toBe('swipe')
    expect(verb('key')).toBe('pressKey')
    expect(verb('rotate')).toBe('rotate')
  })

  it('splits the keyboard toggle by direction, which is what the user perceives', () => {
    // Detaching the hardware keyboard is how the guest's on-screen one appears, so
    // "Hide"/"Show" is the honest reading of a flag named `connected`.
    expect(deviceVerbKey('act', { actions: [{ type: 'keyboard', connected: false }] }))
      .toBe('showKeyboard')
    expect(deviceVerbKey('act', { actions: [{ type: 'keyboard', connected: true }] }))
      .toBe('hideKeyboard')
  })

  it('falls back to the generic verb for a batch rather than naming only the first', () => {
    // "Tapped" on a tap-then-type batch is worse than "Actions Run": the user stops
    // reading at the verb and takes it for the whole story.
    expect(deviceVerbKey('act', { actions: [{ type: 'tap' }, { type: 'type' }] })).toBe('act')
    expect(deviceVerbKey('act', { actions: [{ type: 'tap' }, { type: 'type' }] }, true))
      .toBe('acting')
  })

  it('distinguishes the two query ops and both of their running forms', () => {
    expect(deviceVerbKey('query', { op: 'search' })).toBe('search')
    expect(deviceVerbKey('query', { op: 'inspect' }, true)).toBe('inspecting')
    // Streaming input arrives partial, so `op` may not be there yet.
    expect(deviceVerbKey('query', {}, true)).toBe('querying')
  })
})

describe('device tool input summary', () => {
  it('never puts typed text in the header', () => {
    // The agent types passwords and one-time codes through this tool; the transcript
    // is shared and screenshotted.
    const summary = deviceInputSummary('act', { actions: [{ type: 'type', text: 'hunter2' }] })
    expect(summary).not.toContain('hunter2')
    expect(summary).toBe('••••••')
  })

  it('counts the rest of a batch instead of listing it', () => {
    expect(deviceInputSummary('act', {
      actions: [{ type: 'tap', ref: '@e4' }, { type: 'type' }, { type: 'key' }],
    })).toBe('@e4 · +2')
  })

  it('reads a swipe as travel, from its target towards its direction', () => {
    expect(deviceInputSummary('act', {
      actions: [{ type: 'swipe', ref: '@e2', direction: 'up' }],
    })).toBe('@e2 → up')
  })

  it('quotes the search text and leaves semantic snapshots unlabelled', () => {
    expect(deviceInputSummary('query', { op: 'search', text: 'Settings' })).toBe('“Settings”')
    // semantic is the default, so naming it adds nothing.
    expect(deviceInputSummary('snapshot', { mode: 'semantic' })).toBe('')
    expect(deviceInputSummary('snapshot', { mode: 'fused' })).toBe('fused')
  })

  it('prefers the identifier when describing a wait, because that is what was targeted', () => {
    expect(formatDeviceCondition({ kind: 'exists', identifier: 'submit', label: 'Submit' }))
      .toBe('submit')
    expect(formatDeviceCondition({ kind: 'textContains', label: 'Total', text: '42.00' }))
      .toBe('Total ~ “42.00”')
    expect(deviceInputSummary('wait_for', { condition: { kind: 'notExists', label: 'Spinner' } }))
      .toBe('!Spinner')
  })
})

describe('device tool result parsing', () => {
  it('survives every shape a result can arrive in', () => {
    // Truncated transports, plain-text errors and empty streams all reach this parser.
    expect(parseDeviceResult('act', '{"outcome":"wor', false).status).toBe('neutral')
    expect(parseDeviceResult('snapshot', undefined, false).status).toBe('neutral')
    expect(parseDeviceResult('query', '[]', false).status).toBe('neutral')
  })

  it('strips the agent-facing error code, keeping the sentence a human can read', () => {
    const info = parseDeviceResult('act', '[Error] STALE_STATE: s1 is no longer available.', true)
    expect(info.status).toBe('error')
    expect(info.errorText).toBe('s1 is no longer available.')
  })

  it('reads a snapshot down to the parts the row shows', () => {
    const info = parseDeviceResult('snapshot', JSON.stringify({
      stateId: 's2',
      device: 'iPhone 17 Pro Max',
      orientation: 'landscape-left',
      screen: { width: 1320, height: 2868 },
      settled: false,
      truncated: true,
      image: { path: '/tmp/shot.png', width: 1320, height: 2868 },
    }), false)

    expect(info).toMatchObject({
      status: 'ok',
      device: 'iPhone 17 Pro Max',
      orientation: 'landscape-left',
      imagePath: '/tmp/shot.png',
      settled: false,
      truncated: true,
    })
  })

  it('keeps the reason on a didnt outcome — it is the whole value of the row', () => {
    const info = parseDeviceResult('act', JSON.stringify({
      outcome: 'didnt',
      reason: 'the expected condition did not hold afterwards',
      stateId: 's3',
      orientation: 'portrait',
    }), false)

    expect(info.outcome).toBe('didnt')
    expect(info.reason).toBe('the expected condition did not hold afterwards')
    expect(deviceNeedsAttention(info)).toBe(true)
  })

  it('separates a wait that transitioned from one that was never going to fail', () => {
    const verified = parseDeviceResult('wait_for', JSON.stringify({
      status: 'verified', waitedMs: 620, stateId: 's4',
    }), false)
    const timedOut = parseDeviceResult('wait_for', JSON.stringify({
      status: 'timeout', waitedMs: 5000, stateId: 's5',
    }), false)

    expect(verified.waitStatus).toBe('verified')
    expect(verified.waitedMs).toBe(620)
    expect(deviceNeedsAttention(verified)).toBe(false)
    // A timeout is a successful tool call reporting a failed intent — the row has to
    // show that without the user expanding it.
    expect(deviceNeedsAttention(timedOut)).toBe(true)
  })

  it('does not read an unknown outcome as a successful one', () => {
    const info = parseDeviceResult('act', JSON.stringify({ outcome: 'maybe' }), false)
    expect(info.outcome).toBeUndefined()
    expect(deviceNeedsAttention(info)).toBe(false)
  })
})
