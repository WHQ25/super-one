import { describe, expect, it } from 'vitest'
import {
  agentLaunchErrors,
  agentProfileModelSupport,
  composeSystemPromptAppend,
  launchConfigFromDefaults,
  launchDefaultsFromConfig,
  parseAgentProfileSpec,
  providerLaunchRuntime,
  readAgentProfile,
  resolveAgentLaunchDefaults,
  validateAgentProfileRuntime,
  type AgentProfileCatalog,
} from './agent-profile'

const CLAUDE: AgentProfileCatalog = {
  models: [
    { id: 'sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
    { id: 'opus', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'haiku' },
  ],
}

const CODEX: AgentProfileCatalog = {
  models: [
    {
      id: 'gpt-5.6',
      supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'medium', description: '' }, { value: 'xhigh', description: '' }],
      defaultReasoningEffort: 'medium',
      serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }],
    },
    { id: 'gpt-5.6-mini', supportedReasoningEfforts: [{ value: 'low', description: '' }] },
  ],
}

const GROK: AgentProfileCatalog = {
  models: [
    { id: 'grok-4', contextWindows: [256_000, 1_000_000] },
    { id: 'grok-code', contextWindows: [256_000] },
  ],
  efforts: ['low', 'high'],
  host: { lists: { mode: [] } },
}

const CURSOR: AgentProfileCatalog = {
  models: [{
    id: 'claude-opus-5-5',
    parameters: [
      { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
      { id: 'context', values: [{ value: '200k' }, { value: '1m' }] },
    ],
  }],
}

const OPENCODE: AgentProfileCatalog = {
  models: [{ id: 'anthropic/claude-sonnet-5-5' }],
  host: { lists: { agent: [{ value: 'build', label: 'Build' }, { value: 'plan', label: 'Plan' }] } },
}

const claude = { id: 'claude' as const, name: 'Claude' }
const codex = { id: 'codex' as const, name: 'Codex' }

const spec = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  identity: { name: 'Reviewer', description: 'Reviews diffs without editing.' },
  ...extra,
})

describe('parseAgentProfileSpec', () => {
  it('accepts a minimal spec and trims text', () => {
    const parsed = parseAgentProfileSpec({
      version: 1,
      identity: { name: '  Reviewer ', description: ' Reviews diffs. ' },
      instructions: '  Never edit files.  ',
    })
    expect(parsed).toEqual({
      ok: true,
      value: {
        version: 1,
        identity: { name: 'Reviewer', description: 'Reviews diffs.' },
        instructions: 'Never edit files.',
      },
    })
  })

  it.each([
    [{ ...spec(), version: 2 }, /version must be 1/],
    [{ ...spec(), identity: { name: '', description: 'x' } }, /identity.name/],
    [{ ...spec(), identity: { name: 'x' } }, /identity.description/],
    [spec({ permissions: { mode: 'bypassPermissions' } }), /unknown field\(s\): permissions/],
    [spec({ runtime: { model: 'opus', context: '1m' } }), /runtime has unknown field\(s\): context/],
    [spec({ runtime: { options: { fastMode: 'yes' } } }), /options.fastMode must be a boolean/],
    [spec({ runtime: { options: { colour: 'red' } } }), /options has unknown field: colour/],
    [spec({ runtime: { options: { contextWindow: 1_000_000 } } }), /options.contextWindow requires profile.runtime.model/],
    [spec({ runtime: { model: 'm', options: { modelParams: {} } } }), /modelParams must map parameter ids/],
    [spec({ instructions: 'x'.repeat(20_001) }), /at most 20000/],
  ])('rejects %j', (raw, error) => {
    const parsed = parseAgentProfileSpec(raw)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toMatch(error)
  })

  it('accepts only the options the harness has', () => {
    const fast = spec({ runtime: { options: { fastMode: true } } })
    expect(parseAgentProfileSpec(fast, 'codex').ok).toBe(true)
    const onClaude = parseAgentProfileSpec(fast, 'claude')
    expect(onClaude.ok ? '' : onClaude.error).toBe('profile.runtime.options.fastMode is not a claude setting (claude has: ultracode).')
  })

  it('reads the profile off a provider config and ignores base rows or bad specs', () => {
    expect(readAgentProfile({ apiKey: 'x', profile: spec() })?.identity.name).toBe('Reviewer')
    expect(readAgentProfile({})).toBeNull()
    expect(readAgentProfile({ profile: { version: 9 } })).toBeNull()
    expect(readAgentProfile(null)).toBeNull()
  })
})

describe('prompt composition', () => {
  it('puts instructions before the collaboration protocol and skips blanks', () => {
    expect(composeSystemPromptAppend('Review only.', undefined, ' Protocol ')).toBe('Review only.\n\nProtocol')
    expect(composeSystemPromptAppend(undefined, '  ')).toBeUndefined()
  })
})

describe('agentProfileModelSupport', () => {
  it('reports each harness its own options, per model', () => {
    expect(agentProfileModelSupport('claude', CLAUDE, 'opus')).toEqual({
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      options: { ultracode: { kind: 'toggle' } },
    })
    expect(agentProfileModelSupport('claude', CLAUDE, 'sonnet')?.options).toEqual({ ultracode: null })
    expect(agentProfileModelSupport('codex', CODEX, 'gpt-5.6')?.options).toEqual({ fastMode: { kind: 'toggle' } })
    expect(agentProfileModelSupport('acp', GROK, 'grok-4')?.options).toEqual({
      contextWindow: { kind: 'choice', values: [{ value: 256_000, label: '256K' }, { value: 1_000_000, label: '1M' }] },
      mode: null,
    })
    expect(agentProfileModelSupport('acp', GROK, 'grok-code')?.options.contextWindow).toBeNull()
    expect(agentProfileModelSupport('claude', CLAUDE, 'nope')).toBeNull()
  })

  it('falls back to catalog-level efforts when models carry none (ACP modes)', () => {
    expect(agentProfileModelSupport('acp', GROK, 'grok-4')?.efforts).toEqual(['low', 'high'])
  })
})

describe('validateAgentProfileRuntime', () => {
  it('passes supported combinations on every harness', () => {
    expect(validateAgentProfileRuntime({ model: 'opus', effort: 'max', options: { ultracode: true } }, CLAUDE, claude)).toEqual([])
    expect(validateAgentProfileRuntime({ model: 'gpt-5.6', options: { fastMode: true } }, CODEX, codex)).toEqual([])
    expect(validateAgentProfileRuntime({ model: 'grok-4', options: { contextWindow: 1_000_000 } }, GROK, { id: 'acp', name: 'ACP' })).toEqual([])
    expect(validateAgentProfileRuntime({ model: 'claude-opus-5-5', options: { modelParams: { fast: 'true', context: '1m' } } }, CURSOR, { id: 'cursor', name: 'Cursor' })).toEqual([])
    expect(validateAgentProfileRuntime({ options: { agent: 'plan' } }, OPENCODE, { id: 'opencode', name: 'OpenCode' })).toEqual([])
    expect(validateAgentProfileRuntime({ effort: 'low' }, CODEX, codex)).toEqual([])
    expect(validateAgentProfileRuntime(undefined, { models: [] }, codex)).toEqual([])
  })

  it('names the field and harness for unsupported combinations', () => {
    expect(validateAgentProfileRuntime({ model: 'gpt-x' }, CODEX, codex)[0])
      .toMatch(/runtime.model "gpt-x" is not in the Codex catalog. Available: gpt-5.6, gpt-5.6-mini/)
    expect(validateAgentProfileRuntime({ model: 'sonnet', options: { ultracode: true } }, CLAUDE, claude))
      .toEqual(['options.ultracode is not supported by Claude model "sonnet".'])
    expect(validateAgentProfileRuntime({ model: 'gpt-5.6-mini', options: { fastMode: true } }, CODEX, codex))
      .toEqual(['options.fastMode is not supported by Codex model "gpt-5.6-mini".'])
    expect(validateAgentProfileRuntime({ model: 'haiku', effort: 'high' }, CLAUDE, claude))
      .toEqual(['runtime.effort is not supported by Claude model "haiku".'])
    expect(validateAgentProfileRuntime({ model: 'gpt-5.6-mini', effort: 'xhigh' }, CODEX, codex))
      .toEqual(['runtime.effort "xhigh" is not supported by Codex model "gpt-5.6-mini" (supported: low).'])
    expect(validateAgentProfileRuntime({ model: 'grok-4', options: { contextWindow: 2_000_000 } }, GROK, { id: 'acp', name: 'ACP' }))
      .toEqual(['options.contextWindow 2000000 is not one of: 256000, 1000000.'])
    expect(validateAgentProfileRuntime({ model: 'claude-opus-5-5', options: { modelParams: { context: '2m' } } }, CURSOR, { id: 'cursor', name: 'Cursor' }))
      .toEqual(['options.modelParams.context "2m" is not one of: 200k, 1m.'])
    expect(validateAgentProfileRuntime({ options: { agent: 'review' } }, OPENCODE, { id: 'opencode', name: 'OpenCode' }))
      .toEqual(['options.agent "review" is not one of: "build", "plan".'])
    expect(validateAgentProfileRuntime({ options: { mode: 'ask' } }, GROK, { id: 'acp', name: 'ACP' }))
      .toEqual(['options.mode is not supported by ACP.'])
  })

  it('refuses values it cannot check: no model catalog, or a list the host could not read', () => {
    expect(validateAgentProfileRuntime({ model: 'x' }, { models: [] }, { id: 'dsh', name: 'DeepSeek' })[0]).toMatch(/DeepSeek has no model catalog yet/)
    expect(validateAgentProfileRuntime({ options: { agentPreset: 'minimal' } }, { models: [] }, { id: 'dsh', name: 'DeepSeek' }))
      .toEqual(['DeepSeek has not listed its agentPreset values yet. Open a DeepSeek session once, or leave options.agentPreset out.'])
  })
})

describe('resolveAgentLaunchDefaults — launch > profile > global', () => {
  const base = { model: 'sonnet', effort: 'medium' }
  const resolve = (input: Omit<Parameters<typeof resolveAgentLaunchDefaults>[0], 'harnessId' | 'catalog'> & { catalog?: AgentProfileCatalog }) =>
    resolveAgentLaunchDefaults({ harnessId: 'claude', catalog: CLAUDE, ...input })

  it('keeps the global layer when there is no profile', () => {
    expect(resolve({ base })).toEqual({ model: 'sonnet', effort: 'medium' })
  })

  it('lets the profile override model, effort and options', () => {
    expect(resolve({ base, profile: { model: 'opus', effort: 'max', options: { ultracode: true } } }))
      .toEqual({ model: 'opus', effort: 'max', options: { ultracode: true } })
  })

  it('keeps the global effort when the profile only picks a model that supports it', () => {
    expect(resolve({ base, profile: { model: 'opus' } })).toEqual({ model: 'opus', effort: 'medium' })
  })

  it('drops efforts and options the effective model cannot carry', () => {
    expect(resolve({ base, profile: { model: 'haiku' } })).toEqual({ model: 'haiku' })
    expect(resolveAgentLaunchDefaults({
      harnessId: 'codex',
      catalog: CODEX,
      base: { model: 'gpt-5.6', effort: 'xhigh', options: { fastMode: true } },
      profile: { model: 'gpt-5.6-mini' },
    })).toEqual({ model: 'gpt-5.6-mini', effort: 'low' })
  })

  it('falls back to the global model when the profile model left the catalog', () => {
    expect(resolve({ base, profile: { model: 'retired', effort: 'high' } })).toEqual({ model: 'sonnet', effort: 'high' })
  })

  it('passes validated profile values through when no catalog is cached', () => {
    expect(resolve({ catalog: { models: [] }, base: {}, profile: { model: 'opus', effort: 'max', options: { ultracode: true } } }))
      .toEqual({ model: 'opus', effort: 'max', options: { ultracode: true } })
  })

  it('takes explicit launch fields over the profile', () => {
    expect(resolve({ base, profile: { model: 'opus', effort: 'max' }, launch: { effort: 'low' } })).toEqual({ model: 'opus', effort: 'low' })
  })

  it('re-checks inherited effort and options against a model the launch picks', () => {
    expect(resolve({ base, profile: { model: 'opus', effort: 'max', options: { ultracode: true } }, launch: { model: 'sonnet' } }))
      .toEqual({ model: 'sonnet', effort: 'medium' })
    expect(resolveAgentLaunchDefaults({
      harnessId: 'acp',
      catalog: GROK,
      base: {},
      profile: { model: 'grok-4', options: { contextWindow: 1_000_000 } },
      launch: { model: 'grok-code' },
    })).toEqual({ model: 'grok-code', effort: 'high' })
  })

  it('keeps inherited values for a launch model the catalog does not list', () => {
    expect(resolve({ base, profile: { effort: 'high' }, launch: { model: 'glm-4.6' } })).toEqual({ model: 'glm-4.6', effort: 'high' })
  })

  it('applies only the options this host can apply', () => {
    expect(resolveAgentLaunchDefaults({
      harnessId: 'opencode',
      catalog: { ...OPENCODE, host: { ...OPENCODE.host, appliable: ['agent'] } },
      base: {},
      profile: { options: { agent: 'plan' } },
    }).options).toEqual({ agent: 'plan' })
    expect(resolveAgentLaunchDefaults({
      harnessId: 'claude',
      catalog: { ...CLAUDE, host: { appliable: ['agent'] } },
      base,
      profile: { model: 'opus', options: { ultracode: true } },
    })).toEqual({ model: 'opus', effort: 'medium' })
  })
})

describe('launch config mapping', () => {
  it('keeps Codex Fast in its own launch field and the rest under options', () => {
    expect(launchConfigFromDefaults({ model: 'gpt-5.6', options: { fastMode: true } })).toEqual({ model: 'gpt-5.6', fastMode: true })
    expect(launchConfigFromDefaults({ model: 'grok-4', options: { contextWindow: 1_000_000 } }))
      .toEqual({ model: 'grok-4', options: { contextWindow: 1_000_000 } })
    expect(launchDefaultsFromConfig({ model: 'gpt-5.6', fastMode: false })).toEqual({ model: 'gpt-5.6', options: { fastMode: false } })
    expect(launchDefaultsFromConfig(undefined)).toEqual({})
  })
})

describe('agentLaunchErrors', () => {
  it('rejects an explicit effort or option the catalogued launch model cannot carry', () => {
    expect(agentLaunchErrors(claude, CLAUDE, 'sonnet', { model: 'sonnet', effort: 'max' }))
      .toEqual(['config.effort "max" is not supported by Claude model "sonnet" (supported: low, medium, high).'])
    expect(agentLaunchErrors(codex, CODEX, 'gpt-5.6-mini', { options: { fastMode: true } }))
      .toEqual(['config.fastMode is not supported by Codex model "gpt-5.6-mini".'])
  })

  it('passes supported, inherited-only and uncatalogued launches', () => {
    expect(agentLaunchErrors(claude, CLAUDE, 'opus', { effort: 'max' })).toEqual([])
    expect(agentLaunchErrors(claude, CLAUDE, 'sonnet', { model: 'sonnet' })).toEqual([])
    expect(agentLaunchErrors(claude, CLAUDE, 'glm-4.6', { effort: 'max' })).toEqual([])
  })
})

describe('providerLaunchRuntime', () => {
  it('reads the legacy top-level fields of a row without a profile', () => {
    expect(providerLaunchRuntime({ model: 'claude-sonnet-5-5', effort: 'low' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' })
    expect(providerLaunchRuntime({ model: 'gpt-5.6', reasoningEffort: 'xhigh', fastMode: true }))
      .toEqual({ model: 'gpt-5.6', effort: 'xhigh', options: { fastMode: true } })
    expect(providerLaunchRuntime({ apiKey: 'k' })).toBeUndefined()
  })

  it('lets a profile own the runtime whole, including fields it leaves unset', () => {
    expect(providerLaunchRuntime({ model: 'legacy', effort: 'low', profile: spec({ runtime: { model: 'opus' } }) })).toEqual({ model: 'opus' })
    expect(providerLaunchRuntime({ model: 'legacy', profile: spec() })).toBeUndefined()
  })
})

describe('permission mode', () => {
  it('accepts only a mode the harness offers, naming its modes otherwise', () => {
    expect(parseAgentProfileSpec(spec({ runtime: { permissionMode: 'plan' } }), 'claude'))
      .toMatchObject({ ok: true, value: { runtime: { permissionMode: 'plan' } } })
    expect(parseAgentProfileSpec(spec({ runtime: { permissionMode: 'plan' } }), 'codex')).toEqual({
      ok: false,
      error: 'profile.runtime.permissionMode "plan" is not a codex mode (codex has: default, auto, bypassPermissions).',
    })
    expect(parseAgentProfileSpec(spec({ runtime: { permissionMode: 'default' } }), 'opencode')).toEqual({
      ok: false,
      error: 'profile.runtime.permissionMode is not supported by opencode: it runs its own permission configuration.',
    })
  })

  it('resolves launch > profile > global, skipping a mode the harness does not offer', () => {
    const resolve = (input: { base?: object; profile?: object; launch?: object }) =>
      resolveAgentLaunchDefaults({ harnessId: 'codex', catalog: { models: [] }, base: {}, ...input }).permissionMode
    expect(resolve({ base: { permissionMode: 'default' }, profile: { permissionMode: 'auto' } })).toBe('auto')
    expect(resolve({ profile: { permissionMode: 'auto' }, launch: { permissionMode: 'bypassPermissions' } })).toBe('bypassPermissions')
    expect(resolve({ base: { permissionMode: 'default' }, profile: { permissionMode: 'plan' } })).toBe('default')
    expect(launchConfigFromDefaults({ model: 'gpt-5.6', permissionMode: 'auto' })).toEqual({ model: 'gpt-5.6', permissionMode: 'auto' })
  })
})
