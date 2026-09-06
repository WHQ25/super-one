import { describe, expect, it } from 'vitest'
import type { HarnessId, SandboxMode } from '../agent-types'
import {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
  resolveSandboxMode,
  sandboxModeFromInfo,
} from './harness-sandbox'

const OFF = { enabled: false, autoAllowBash: false }
const ON = { enabled: true, autoAllowBash: false }
const AUTO = { enabled: true, autoAllowBash: true }

describe('a harness that drives its own sandbox', () => {
  it('reports the mode the session is actually set to', () => {
    expect(resolveSandboxMode({ harnessId: 'claude', sandboxInfo: OFF })).toBe('off')
    expect(resolveSandboxMode({ harnessId: 'claude', sandboxInfo: ON })).toBe('on')
    expect(resolveSandboxMode({ harnessId: 'claude', sandboxInfo: AUTO })).toBe('auto')
  })

  // Cursor's SDK has no autoAllowBash, so `auto` has to land somewhere it can honour.
  it('folds Cursor onto plain on, because it has no auto', () => {
    expect(harnessSandboxModes('cursor')).toEqual(['off', 'on'])
    expect(resolveSandboxMode({ harnessId: 'cursor', sandboxInfo: AUTO })).toBe('on')
    expect(coerceSandboxModeForHarness('cursor', 'auto')).toBe('on')
  })

  it('reads a session with no reported sandbox as off', () => {
    expect(sandboxModeFromInfo(null)).toBe('off')
    expect(resolveSandboxMode({ harnessId: 'claude', sandboxInfo: null })).toBe('off')
  })
})

describe('a harness that folds sandbox into its permission setting', () => {
  it.each([
    ['plan', 'on'],
    ['default', 'on'],
    ['auto', 'on'],
    ['acceptEdits', 'on'],
    ['dontAsk', 'on'],
    ['bypassPermissions', 'off'],
  ] as Array<[string, SandboxMode]>)('reads %s as sandbox %s for codex and dsh', (permissionMode, expected) => {
    for (const harnessId of ['codex', 'dsh'] as HarnessId[]) {
      expect(resolveSandboxMode({ harnessId, permissionMode })).toBe(expected)
    }
  })

  // The desktop store holds Codex's own preset, which is finer than the carrier mode.
  it('prefers Codex’s native preset when the caller has one', () => {
    expect(resolveSandboxMode({ harnessId: 'codex', permissionMode: 'default', codexPreset: 'full-access' })).toBe('off')
    expect(resolveSandboxMode({ harnessId: 'codex', permissionMode: 'bypassPermissions', codexPreset: 'read-only' })).toBe('on')
  })

  it('ignores a sandboxInfo it was handed — the permission setting is the answer', () => {
    expect(resolveSandboxMode({ harnessId: 'codex', permissionMode: 'bypassPermissions', sandboxInfo: AUTO })).toBe('off')
  })
})

describe('a harness SuperOne does not drive', () => {
  // Grok confines itself at process start; claiming `off` would deny a real sandbox.
  it('reports the sandbox ACP observed about itself', () => {
    expect(resolveSandboxMode({ harnessId: 'acp', sandboxInfo: ON })).toBe('on')
    expect(resolveSandboxMode({ harnessId: 'acp', sandboxInfo: null })).toBe('off')
  })

  it('reports off for OpenCode, which has no sandbox mechanism at all', () => {
    expect(resolveSandboxMode({ harnessId: 'opencode', sandboxInfo: AUTO, permissionMode: 'plan' })).toBe('off')
  })
})
