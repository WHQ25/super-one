import { beforeEach, describe, expect, it } from 'vitest'
import {
  computerInputSummary,
  computerTargetBundleId,
  computerVerbKey,
  getComputerOp,
  isReadComputerOp,
  parseComputerResult,
  resetComputerUseTargetCacheForTests,
} from './computer-tool-display'

beforeEach(() => {
  resetComputerUseTargetCacheForTests()
})

describe('getComputerOp', () => {
  it('recognizes the complete Computer Use surface', () => {
    expect(
      [
        'computer_apps',
        'computer_snapshot',
        'computer_zoom',
        'computer_query',
        'computer_act',
        'computer_wait_for',
      ].map(getComputerOp),
    ).toEqual(['apps', 'snapshot', 'zoom', 'query', 'act', 'wait_for'])
    expect(getComputerOp('browser_click')).toBeNull()
    expect(getComputerOp('computer_unknown')).toBeNull()
  })
})

describe('computerVerbKey', () => {
  it('uses action-specific verbs for multiplexed tools', () => {
    expect(computerVerbKey('apps', { action: 'launch' })).toBe('launch')
    expect(computerVerbKey('apps', { action: 'focus' }, true)).toBe('focusing')
    expect(computerVerbKey('query', { op: 'search' }, true)).toBe('searching')
    expect(
      computerVerbKey('act', { actions: [{ type: 'click', ref: '@e1' }] }),
    ).toBe('click')
    expect(
      computerVerbKey(
        'act',
        { actions: [{ type: 'moveMouse', x: 10, y: 20 }] },
        true,
      ),
    ).toBe('movingPointer')
    expect(
      computerVerbKey('act', {
        actions: [{ type: 'click' }, { type: 'scroll' }],
      }),
    ).toBe('act')
  })
})

describe('computerInputSummary', () => {
  it('summarizes targets and regions', () => {
    expect(
      computerInputSummary('apps', { action: 'focus', app: 'TextEdit' }),
    ).toBe('TextEdit')
    expect(
      computerInputSummary('snapshot', {
        root: '@r2',
        mode: 'visual',
        capture: 'display',
      }),
    ).toBe('@r2 · visual · display')
    expect(
      computerInputSummary('zoom', {
        stateId: '@s1',
        region: [10, 20, 100, 200],
      }),
    ).toBe('@s1 · [10, 20, 100, 200]')
    expect(
      computerInputSummary('query', {
        stateId: '@s1',
        op: 'search',
        text: 'Save',
      }),
    ).toBe('@s1 · “Save”')
  })

  it('redacts typed values and summarizes batched actions', () => {
    const summary = computerInputSummary('act', {
      actions: [
        { type: 'typeText', ref: '@e3', text: 'top-secret-value' },
        { type: 'keypress', keys: ['ENTER'] },
      ],
    })
    expect(summary).toBe('@e3 ← •••••• · +1')
    expect(summary).not.toContain('top-secret-value')
  })

  it('formats wait conditions without exposing valueEquals values', () => {
    const summary = computerInputSummary('wait_for', {
      condition: { kind: 'valueEquals', ref: '@e4', value: 'private-token' },
      timeoutMs: 5000,
    })
    expect(summary).toBe('@e4 = •••••• · 5000ms')
    expect(summary).not.toContain('private-token')
  })
})

describe('isReadComputerOp', () => {
  it('keeps read results expandable and actions lean', () => {
    expect(isReadComputerOp('apps', {})).toBe(true)
    expect(isReadComputerOp('apps', { action: 'launch' })).toBe(false)
    expect(isReadComputerOp('snapshot', {})).toBe(true)
    expect(isReadComputerOp('query', {})).toBe(true)
    expect(isReadComputerOp('act', {})).toBe(false)
  })
})

describe('parseComputerResult', () => {
  it('summarizes app discovery', () => {
    const info = parseComputerResult(
      'apps',
      JSON.stringify({
        granted: [{ app: 'TextEdit' }],
        running: [{ app: 'TextEdit' }, { app: 'Finder' }],
        roots: [{ rootId: '@r1' }, { rootId: '@r2' }, { rootId: '@r3' }],
        frontmost: 'TextEdit',
      }),
      false,
    )
    // list does not pin a single app (would otherwise show frontmost / SuperOne).
    expect(info).toMatchObject({
      status: 'ok',
      counts: { granted: 1, running: 2, roots: 3 },
    })
    expect(info.bundleId).toBeUndefined()
  })

  it('extracts observation and zoom screenshots', () => {
    expect(
      parseComputerResult(
        'snapshot',
        JSON.stringify({
          stateId: '@s1',
          root: {
            app: 'TextEdit',
            bundleId: 'com.apple.TextEdit',
            title: 'Notes',
          },
          image: { path: '/tmp/observe.png' },
        }),
        false,
      ),
    ).toMatchObject({
      status: 'ok',
      stateId: '@s1',
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      title: 'Notes',
      imagePath: '/tmp/observe.png',
    })
    expect(
      parseComputerResult(
        'zoom',
        JSON.stringify({
          stateId: '@s1',
          root: { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
          image: { path: '/tmp/zoom.png' },
        }),
        false,
      ),
    ).toMatchObject({
      imagePath: '/tmp/zoom.png',
      bundleId: 'com.apple.TextEdit',
    })
  })

  it('extracts query, action, and wait outcomes', () => {
    expect(
      parseComputerResult(
        'query',
        JSON.stringify({ matches: [{ ref: '@e1' }, { ref: '@e2' }] }),
        false,
      ).counts?.matches,
    ).toBe(2)
    expect(
      parseComputerResult(
        'act',
        JSON.stringify({
          outcome: 'worked',
          successorStateId: '@s2',
          successorRoot: {
            app: 'TextEdit',
            bundleId: 'com.apple.TextEdit',
            title: 'Notes',
          },
          successorImage: { path: '/tmp/after.png' },
          evidence: [{ description: 'value changed' }],
        }),
        false,
      ),
    ).toMatchObject({
      outcome: 'worked',
      stateId: '@s2',
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      imagePath: '/tmp/after.png',
      counts: { evidence: 1 },
    })
    expect(
      parseComputerResult(
        'wait_for',
        JSON.stringify({
          status: 'verified',
          successorStateId: '@s3',
        }),
        false,
      ),
    ).toMatchObject({ waitStatus: 'verified', stateId: '@s3' })
  })

  it('resolves focus/launch target for the leading icon', () => {
    const info = parseComputerResult(
      'apps',
      JSON.stringify({
        action: 'focus',
        frontmost: 'Finder',
        target: {
          app: 'TextEdit',
          bundleId: 'com.apple.TextEdit',
          pid: 7,
        },
      }),
      false,
      { action: 'focus', app: 'TextEdit' },
    )
    expect(info).toMatchObject({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
    })
    // Even while streaming (no result yet), bundle id comes from params.app.
    expect(
      computerTargetBundleId(
        'apps',
        { action: 'focus', app: 'com.apple.TextEdit' },
        { status: 'neutral' },
      ),
    ).toBe('com.apple.TextEdit')
    expect(
      computerTargetBundleId(
        'apps',
        { action: 'focus', app: 'TextEdit' },
        info,
      ),
    ).toBe('com.apple.TextEdit')
  })

  it('prefers the explicit apps target over the frontmost app', () => {
    const info = parseComputerResult(
      'apps',
      JSON.stringify({
        action: 'launch',
        target: {
          app: 'Doubao',
          bundleId: 'com.bot.pc.doubao',
          pid: 42,
        },
        frontmost: 'SuperOne',
      }),
      false,
      { action: 'launch', app: 'Doubao' },
    )

    expect(info).toMatchObject({
      app: 'Doubao',
      bundleId: 'com.bot.pc.doubao',
    })
    expect(
      computerTargetBundleId(
        'apps',
        { action: 'launch', app: 'com.bot.pc.doubao' },
        info,
      ),
    ).toBe('com.bot.pc.doubao')
  })

  it('parses TOON launch target without using frontmost for the icon', () => {
    const toon = [
      'action: launch',
      'frontmost: Electron',
      'clipboardGrant: false',
      'target:',
      '  app: Doubao',
      '  bundleId: com.bot.pc.doubao',
      '  pid: "67268"',
    ].join('\n')
    const info = parseComputerResult(
      'apps',
      toon,
      false,
      { action: 'launch', app: 'com.bot.pc.doubao' },
    )
    expect(info).toMatchObject({
      app: 'Doubao',
      bundleId: 'com.bot.pc.doubao',
    })
    expect(
      computerTargetBundleId(
        'apps',
        { action: 'launch', app: 'com.bot.pc.doubao' },
        info,
      ),
    ).toBe('com.bot.pc.doubao')
  })

  it('list action has no target bundle id for the leading icon', () => {
    const toon = [
      'action: list',
      'frontmost: Electron',
      'total: 1',
      'apps[1]{app,bundleId,running,frontmost,granted,grantScope,pid,windows}:',
      '  Doubao,com.bot.pc.doubao,false,false,true,session,null,0',
    ].join('\n')
    const info = parseComputerResult('apps', toon, false, { action: 'list' })
    expect(info.status).toBe('ok')
    expect(info.bundleId).toBeUndefined()
    expect(
      computerTargetBundleId('apps', { action: 'list' }, info),
    ).toBeUndefined()
    expect(info.counts?.total).toBe(1)
  })

  it('extracts target identity from query and wait results', () => {
    const root = {
      app: 'Doubao',
      bundleId: 'com.bot.pc.doubao',
      title: 'New chat',
    }

    expect(
      parseComputerResult(
        'query',
        JSON.stringify({ matches: [], root }),
        false,
      ),
    ).toMatchObject(root)
    expect(
      parseComputerResult(
        'wait_for',
        JSON.stringify({
          status: 'verified',
          successorStateId: '@s3',
          successorRoot: root,
        }),
        false,
      ),
    ).toMatchObject(root)
  })

  it('handles structured, explicit, and malformed errors safely', () => {
    expect(
      parseComputerResult(
        'act',
        JSON.stringify({ error: 'STALE_STATE', message: 'Window changed' }),
        false,
      ),
    ).toEqual({ status: 'error', errorText: 'Window changed' })
    expect(
      parseComputerResult('snapshot', '[Error] helper offline', true),
    ).toEqual({ status: 'error', errorText: 'helper offline' })
    expect(parseComputerResult('query', 'not json', false)).toEqual({
      status: 'neutral',
    })
  })

  it('resolves act icon from successorRoot even when outcome is unknown', () => {
    const info = parseComputerResult(
      'act',
      JSON.stringify({
        outcome: 'unknown',
        grounding: 'semantic',
        successorStateId: 'S2',
        successorRoot: {
          app: '爱奇艺',
          bundleId: 'com.iqiyi.player',
          title: '爱奇艺',
        },
        evidence: [{ description: 'ax press @e32' }],
      }),
      false,
      { stateId: 'S1', delivery: 'semantic' },
    )
    expect(info).toMatchObject({
      outcome: 'unknown',
      bundleId: 'com.iqiyi.player',
      stateId: 'S2',
    })
    expect(
      computerTargetBundleId(
        'act',
        { stateId: 'S1', delivery: 'semantic' },
        info,
      ),
    ).toBe('com.iqiyi.player')
  })

  it('uses prior snapshot/act target so streaming act shows the app icon', () => {
    parseComputerResult(
      'snapshot',
      JSON.stringify({
        stateId: 'S1',
        root: {
          app: '爱奇艺',
          bundleId: 'com.iqiyi.player',
          title: '爱奇艺',
        },
      }),
      false,
    )
    // No result yet (streaming) — should still resolve via stateId cache.
    expect(
      computerTargetBundleId(
        'act',
        { stateId: 'S1', actions: [{ type: 'press', ref: '@e32' }] },
        { status: 'neutral' },
      ),
    ).toBe('com.iqiyi.player')
  })

  it('scrapes bundleId from truncated act JSON for the leading icon', () => {
    const truncated =
      '{"outcome":"unknown","successorRoot":{"app":"爱奇艺","bundleId":"com.iqiyi.player","title":"爱奇艺"},"diff":{"removed":["@e1"'
    const info = parseComputerResult('act', truncated, false, {
      stateId: 'S1',
    })
    expect(info.bundleId).toBe('com.iqiyi.player')
    expect(
      computerTargetBundleId('act', { stateId: 'S1' }, info),
    ).toBe('com.iqiyi.player')
  })
})
