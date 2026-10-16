import { describe, expect, it } from 'vitest'
import type { AppSettings, HarnessId } from '../agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '../launch-options'
import { codexPermissionModeForPreset, sessionDefaultsForHarness } from './session-defaults'

type Preferences = AppSettings['agentPreference']

function preferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    claude: {
      defaultModel: '',
      defaultEffort: '',
      defaultPermissionMode: '',
      defaultSandboxMode: '',
      brandHue: null, darkBrandHue: null,
      tokenOverrides: {}, darkTokenOverrides: {},
      disabledSkills: [],
      askUserQuestionPreviewFormat: 'markdown',
    },
    codex: {
      defaultModel: '',
      defaultReasoningEffort: '',
      defaultPermissionPreset: '',
      defaultFastMode: false,
      realtimeVoice: '',
      brandHue: null, darkBrandHue: null,
      tokenOverrides: {}, darkTokenOverrides: {},
    },
    acp: {
      enabled: false,
      brandHue: null, darkBrandHue: null,
      tokenOverrides: {}, darkTokenOverrides: {},
      selectedAgentId: null,
      defaultPermissionMode: '',
    },
    cursor: { brandHue: null, darkBrandHue: null, tokenOverrides: {}, darkTokenOverrides: {}, defaultPermissionMode: '', defaultSandboxMode: '' },
    dsh: { brandHue: null, darkBrandHue: null, tokenOverrides: {}, darkTokenOverrides: {}, defaultPermissionMode: '' },
    opencode: { brandHue: null, darkBrandHue: null, tokenOverrides: {}, darkTokenOverrides: {}, defaultPermissionMode: '' },
    ...overrides,
  } as Preferences
}

const HARNESSES = Object.keys(HARNESS_LAUNCH_OPTIONS) as HarnessId[]

describe('sessionDefaultsForHarness', () => {
  it.each(HARNESSES)('falls back to the default mode %s declares when unconfigured', (harnessId) => {
    const defaults = sessionDefaultsForHarness(preferences(), harnessId)

    expect(defaults.permissionMode).toBe(HARNESS_LAUNCH_OPTIONS[harnessId].defaultPermissionMode)
    expect(defaults.configuredPermissionMode).toBe('')
  })

  it.each(HARNESSES)('declares a default %s offers', (harnessId) => {
    const { permissionModes, defaultPermissionMode } = HARNESS_LAUNCH_OPTIONS[harnessId]
    if (permissionModes.length > 0) expect(permissionModes).toContain(defaultPermissionMode)
  })

  /** dsh lists read-only first for display; its own default preset is workspace-write. */
  it('starts dsh in workspace-write, not the first listed mode', () => {
    expect(sessionDefaultsForHarness(preferences(), 'dsh').permissionMode).toBe('default')
  })

  /**
   * The whole point of the per-harness split: a mode set on one harness must not
   * leak onto another, which is exactly what the previous global setting did.
   */
  it('keeps a configured mode on the harness it was set for', () => {
    const prefs = preferences({
      claude: { ...preferences().claude, defaultPermissionMode: 'auto' },
    })

    expect(sessionDefaultsForHarness(prefs, 'claude').permissionMode).toBe('auto')
    expect(sessionDefaultsForHarness(prefs, 'acp').permissionMode).toBe('default')
    expect(sessionDefaultsForHarness(prefs, 'dsh').permissionMode).toBe('default')
  })

  it('reads each harness from its own slot', () => {
    const prefs = preferences({
      acp: { ...preferences().acp, defaultPermissionMode: 'plan' },
      opencode: { ...preferences().opencode, defaultPermissionMode: 'acceptEdits' },
    })

    expect(sessionDefaultsForHarness(prefs, 'acp').permissionMode).toBe('plan')
    expect(sessionDefaultsForHarness(prefs, 'opencode').permissionMode).toBe('default')
    expect(sessionDefaultsForHarness(prefs, 'opencode').configuredPermissionMode).toBe('')
  })

  /** Cursor's ladder shares no spelling with Claude's, so it gets its own value. */
  it('honours the Cursor vocabulary', () => {
    const prefs = preferences({
      cursor: { ...preferences().cursor, defaultPermissionMode: 'plan', defaultSandboxMode: 'on' },
    })
    const defaults = sessionDefaultsForHarness(prefs, 'cursor')

    expect(defaults.permissionMode).toBe('plan')
    expect(defaults.sandboxMode).toBe('on')
  })

  it('drops a stored mode the harness does not offer', () => {
    const prefs = preferences({
      dsh: { ...preferences().dsh, defaultPermissionMode: 'acceptEdits' },
    })

    expect(sessionDefaultsForHarness(prefs, 'dsh').permissionMode).toBe('default')
  })

  /** Codex executes presets, so its shared mode is a projection of one. */
  it('projects the Codex preset onto the shared vocabulary', () => {
    const prefs = preferences({
      codex: { ...preferences().codex, defaultPermissionPreset: 'auto-review' },
    })

    expect(sessionDefaultsForHarness(prefs, 'codex').permissionMode).toBe('auto')
  })

  it('reports no sandbox for the harnesses that own no toggle', () => {
    const prefs = preferences({
      claude: { ...preferences().claude, defaultSandboxMode: 'on' },
    })

    expect(sessionDefaultsForHarness(prefs, 'claude').sandboxMode).toBe('on')
    for (const harnessId of ['codex', 'acp', 'opencode', 'dsh'] as HarnessId[]) {
      expect(sessionDefaultsForHarness(prefs, harnessId).sandboxMode).toBeNull()
    }
  })

  /** `null` is "no toggle"; `off` is a choice. Conflating them lies about the session. */
  it('distinguishes an unset sandbox from an explicit off', () => {
    const unset = sessionDefaultsForHarness(preferences(), 'claude')
    const off = sessionDefaultsForHarness(
      preferences({ claude: { ...preferences().claude, defaultSandboxMode: 'off' } }),
      'claude',
    )

    expect(unset.sandboxMode).toBeNull()
    expect(off.sandboxMode).toBe('off')
  })
})

describe('codexPermissionModeForPreset', () => {
  it.each([
    ['auto-review', 'auto'],
    ['full-access', 'bypassPermissions'],
    ['default', 'default'],
  ] as const)('projects %s onto %s', (preset, mode) => {
    expect(codexPermissionModeForPreset(preset)).toBe(mode)
  })

  it('has no spelling for read-only', () => {
    expect(codexPermissionModeForPreset('read-only')).toBe('')
  })
})
