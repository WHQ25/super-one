import { describe, expect, it } from 'vitest'
import {
  deviceInputSummary,
  deviceToolVerbKey,
  deviceNeedsAttention,
  deviceVerbKey,
  formatDeviceCondition,
  getDeviceOp,
  parseDeviceResult,
} from './device-tool-display'

describe('deviceToolVerbKey', () => {
  it('names our own device tools so the permission prompt can too', () => {
    expect(deviceToolVerbKey('mcp__superone__device_request_control', {})).toBe('requestControl')
    expect(deviceToolVerbKey('mcp__superone__device_list', {})).toBe('list')
    expect(deviceToolVerbKey('mcp__superone__device_act', {
      actions: [{ type: 'tap', x: 0.5, y: 0.5 }],
    })).toBe('tap')
  })

  it('leaves everything else on the generic MCP label', () => {
    // Same bare name, different server: not ours to title.
    expect(deviceToolVerbKey('mcp__other__device_request_control', {})).toBeNull()
    expect(deviceToolVerbKey('mcp__superone__browser_navigate', {})).toBeNull()
    expect(deviceToolVerbKey('Bash', {})).toBeNull()
  })
})

describe('device tool op routing', () => {
  it('claims every device tool and nothing that merely starts the same way', () => {
    expect(getDeviceOp('device_snapshot')).toBe('snapshot')
    expect(getDeviceOp('device_wait_for')).toBe('wait_for')
    // Both halves of the discovery/redeem pair. Missing either drops it onto the
    // generic MCP row, which says "superone · device list" and nothing else.
    expect(getDeviceOp('device_list')).toBe('list')
    expect(getDeviceOp('device_request_control')).toBe('request_control')
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

describe('device catalog rows', () => {
  it('draws the overview as running-then-recent, and reports the machine-wide total', () => {
    const info = parseDeviceResult('list', JSON.stringify({
      controlled: { id: 'a', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
      running: [
        { id: 'a', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4', running: true, controlled: true },
        { id: 'b', name: 'iPhone 17', platform: 'iOS 26.4', running: true, busy: true },
      ],
      recent: [{ id: 'c', name: 'iPad Pro 13-inch', platform: 'iOS 18.0' }],
      kinds: [{ kind: 'iphone', name: 'iPhone', models: 8, devices: 74 }],
      total: 117,
      note: 'ready',
    }), false)

    expect(info.groups?.map((group) => group.id)).toEqual(['running', 'recent'])
    // The count is the machine, not the rows: three devices are drawn, 117 exist, and
    // the row saying "3" would misreport what the agent is choosing from.
    expect(info.deviceCount).toBe(117)
    expect(info.runningCount).toBe(2)
    expect(info.device).toBe('iPhone 17 Pro Max')
    expect(info.groups?.[0]?.devices[1]).toMatchObject({ name: 'iPhone 17', busy: true })
    // Absent flags stay absent rather than becoming `false`, so the row can tell
    // "not running" from "the tool did not say".
    expect(info.groups?.[1]?.devices[0]).not.toHaveProperty('running')
  })

  it('drops an overview section that has nothing in it', () => {
    const info = parseDeviceResult('list', JSON.stringify({
      controlled: null,
      running: [],
      kinds: [{ kind: 'iphone', name: 'iPhone', models: 8, devices: 74 }],
      total: 74,
    }), false)

    expect(info.groups).toEqual([])
    expect(info.deviceCount).toBe(74)
  })

  it('draws the kind tier as models, headed by the kind and labelled with the newest runtime', () => {
    const info = parseDeviceResult('list', JSON.stringify({
      kind: 'iphone',
      name: 'iPhone',
      models: [
        { model: 'iPhone 17 Pro Max', devices: 5, latest: 'iOS 26.5', running: 1 },
        { model: 'iPhone 16', devices: 3, latest: 'iOS 18.0' },
      ],
    }), false)

    expect(info.groups?.[0]).toMatchObject({ id: 'models', name: 'iPhone' })
    expect(info.groups?.[0]?.devices[0]).toMatchObject({
      id: 'iPhone 17 Pro Max', name: 'iPhone 17 Pro Max', platform: 'iOS 26.5', running: true,
    })
    // A model nobody is running must not light the dot.
    expect(info.groups?.[0]?.devices[1]).not.toHaveProperty('running')
  })

  it('names the model tier rows after their heading, since the tool drops the repeat', () => {
    const info = parseDeviceResult('list', JSON.stringify({
      model: 'iPhone 17 Pro Max',
      devices: [
        { id: 'newest', platform: 'iOS 26.5', running: true },
        { id: 'renamed', platform: 'iOS 18.0', name: 'checkout rig' },
      ],
    }), false)

    expect(info.groups?.[0]).toMatchObject({ id: 'devices', name: 'iPhone 17 Pro Max' })
    expect(info.groups?.[0]?.devices[0]).toMatchObject({ id: 'newest', name: 'iPhone 17 Pro Max' })
    expect(info.groups?.[0]?.devices[1]).toMatchObject({ id: 'renamed', name: 'checkout rig' })
    expect(info.deviceCount).toBe(2)
  })

  it('survives a catalog whose sections are missing or malformed', () => {
    expect(parseDeviceResult('list', JSON.stringify({ running: null }), false).deviceCount).toBe(0)
    expect(parseDeviceResult('list', JSON.stringify({
      running: [null, 'nope', { platform: 'iOS 26.4' }],
    }), false).groups).toEqual([])
    expect(parseDeviceResult('list', JSON.stringify({
      models: [null, { devices: 2 }],
    }), false).groups).toEqual([])
  })

  it('reads back which device a control request bound, and whether it had to ask', () => {
    const granted = parseDeviceResult('request_control', JSON.stringify({
      controlled: true,
      alreadyControlled: true,
      device: { id: 'a', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
    }), false)

    expect(granted.device).toBe('iPhone 17 Pro Max')
    expect(granted.alreadyControlled).toBe(true)
  })

  it('shows a refused request as the user\'s decision, not as a fault', () => {
    // DECLINED and NO_DEVICE both arrive as errors on the wire; only the code says
    // which one the user is looking at.
    const declined = parseDeviceResult(
      'request_control',
      '[Error] DECLINED: The user declined to hand over iPhone 17 Pro Max. They said: use the iPad.',
      true,
    )
    expect(declined.status).toBe('denied')
    expect(declined.errorText).toMatch(/use the iPad/)

    const broken = parseDeviceResult('request_control', '[Error] NO_DEVICE: No simulators exist.', true)
    expect(broken.status).toBe('error')
  })

  it('falls back to the device the agent asked for while the request is still open', () => {
    expect(deviceInputSummary('request_control', { device: '427A175E' })).toBe('427A175E')
    expect(deviceInputSummary('list', {})).toBe('')
  })

  it('uses the discovery verbs so the row does not read as an action on the device', () => {
    expect(deviceVerbKey('list', {})).toBe('list')
    expect(deviceVerbKey('list', {}, true)).toBe('listing')
    expect(deviceVerbKey('request_control', {})).toBe('requestControl')
    expect(deviceVerbKey('request_control', {}, true)).toBe('requestingControl')
  })
})
