import { describe, expect, it } from 'vitest'
import {
  agentProfileModelId,
  agentProfileModelSupport,
  composeSystemPromptAppend,
  parseAgentProfileSpec,
  readAgentProfile,
  resolveAgentLaunchDefaults,
  validateAgentProfileRuntime,
  type AgentProfileCatalog,
} from './agent-profile'

const CLAUDE: AgentProfileCatalog = {
  models: [
    { id: 'sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
    { id: 'opus', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'opus[1m]', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
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
    [spec({ runtime: { model: 'opus', tools: [] } }), /runtime has unknown field\(s\): tools/],
    [spec({ runtime: { model: 'opus[1m]' } }), /use context "1m"/],
    [spec({ runtime: { context: '1m' } }), /context requires profile.runtime.model/],
    [spec({ runtime: { fastMode: 'yes' } }), /fastMode must be a boolean/],
    [spec({ instructions: 'x'.repeat(20_001) }), /at most 20000/],
  ])('rejects %j', (raw, error) => {
    const parsed = parseAgentProfileSpec(raw)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toMatch(error)
  })

  it('reads the profile off a provider config and ignores base rows or bad specs', () => {
    expect(readAgentProfile({ apiKey: 'x', profile: spec() })?.identity.name).toBe('Reviewer')
    expect(readAgentProfile({})).toBeNull()
    expect(readAgentProfile({ profile: { version: 9 } })).toBeNull()
    expect(readAgentProfile(null)).toBeNull()
  })
})

describe('model id and prompt composition', () => {
  it('applies the 1M context variant as the [1m] suffix', () => {
    expect(agentProfileModelId({ model: 'opus', context: '1m' })).toBe('opus[1m]')
    expect(agentProfileModelId({ model: 'opus' })).toBe('opus')
    expect(agentProfileModelId(undefined)).toBeUndefined()
  })

  it('puts instructions before the collaboration protocol and skips blanks', () => {
    expect(composeSystemPromptAppend('Review only.', undefined, ' Protocol ')).toBe('Review only.\n\nProtocol')
    expect(composeSystemPromptAppend(undefined, '  ')).toBeUndefined()
  })
})

describe('agentProfileModelSupport', () => {
  it('derives efforts, fast mode and contexts from the catalog', () => {
    expect(agentProfileModelSupport(CLAUDE, 'opus')).toEqual({
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      fastMode: false,
      contexts: ['default', '1m'],
    })
    expect(agentProfileModelSupport(CODEX, 'gpt-5.6')).toEqual({
      efforts: ['low', 'medium', 'xhigh'],
      fastMode: true,
      contexts: ['default'],
    })
    expect(agentProfileModelSupport(CLAUDE, 'nope')).toBeNull()
  })

  it('falls back to catalog-level efforts when models carry none (ACP modes)', () => {
    expect(agentProfileModelSupport({ models: [{ id: 'grok-4.5' }], efforts: ['low', 'high'] }, 'grok-4.5')?.efforts)
      .toEqual(['low', 'high'])
  })
})

describe('validateAgentProfileRuntime', () => {
  it('passes supported combinations', () => {
    expect(validateAgentProfileRuntime({ model: 'opus', effort: 'max', context: '1m' }, CLAUDE, 'Claude')).toEqual([])
    expect(validateAgentProfileRuntime({ model: 'gpt-5.6', fastMode: true }, CODEX, 'Codex')).toEqual([])
    expect(validateAgentProfileRuntime({ effort: 'low' }, CODEX, 'Codex')).toEqual([])
    expect(validateAgentProfileRuntime(undefined, { models: [] }, 'Codex')).toEqual([])
  })

  it('names the field and harness for unsupported combinations', () => {
    expect(validateAgentProfileRuntime({ model: 'gpt-x' }, CODEX, 'Codex')[0])
      .toMatch(/runtime.model "gpt-x" is not in the Codex catalog. Available: gpt-5.6, gpt-5.6-mini/)
    expect(validateAgentProfileRuntime({ model: 'sonnet', context: '1m' }, CLAUDE, 'Claude'))
      .toEqual(['runtime.context "1m" is not supported by Claude model "sonnet".'])
    expect(validateAgentProfileRuntime({ model: 'opus', fastMode: true }, CLAUDE, 'Claude'))
      .toEqual(['runtime.fastMode is not supported by Claude model "opus".'])
    expect(validateAgentProfileRuntime({ model: 'haiku', effort: 'high' }, CLAUDE, 'Claude'))
      .toEqual(['runtime.effort is not supported by Claude model "haiku".'])
    expect(validateAgentProfileRuntime({ model: 'gpt-5.6-mini', effort: 'xhigh' }, CODEX, 'Codex'))
      .toEqual(['runtime.effort "xhigh" is not supported by Codex model "gpt-5.6-mini" (supported: low).'])
    expect(validateAgentProfileRuntime({ fastMode: true }, CODEX, 'Codex')).toEqual(['runtime.fastMode requires runtime.model.'])
  })

  it('refuses runtime values when the harness has no catalog to check them against', () => {
    expect(validateAgentProfileRuntime({ model: 'x' }, { models: [] }, 'DeepSeek')[0]).toMatch(/DeepSeek has no model catalog yet/)
  })
})

describe('resolveAgentLaunchDefaults — launch > profile > global', () => {
  const base = { model: 'sonnet', effort: 'medium' }

  it('keeps the global layer when there is no profile', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CLAUDE, base })).toEqual({ model: 'sonnet', effort: 'medium' })
  })

  it('lets the profile override model, effort and context', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CLAUDE, base, profile: { model: 'opus', effort: 'max', context: '1m' } }))
      .toEqual({ model: 'opus[1m]', effort: 'max' })
  })

  it('keeps the global effort when the profile only picks a model that supports it', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CLAUDE, base, profile: { model: 'opus' } }))
      .toEqual({ model: 'opus', effort: 'medium' })
  })

  it('drops efforts the effective model cannot carry', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CLAUDE, base, profile: { model: 'haiku' } })).toEqual({ model: 'haiku' })
    expect(resolveAgentLaunchDefaults({
      catalog: CODEX,
      base: { model: 'gpt-5.6', effort: 'xhigh', fastMode: true },
      profile: { model: 'gpt-5.6-mini' },
    })).toEqual({ model: 'gpt-5.6-mini', effort: 'low', fastMode: false })
  })

  it('applies profile fast mode only where the model has a fast tier', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CODEX, base: { model: 'gpt-5.6', fastMode: false }, profile: { fastMode: true } }))
      .toEqual({ model: 'gpt-5.6', effort: 'medium', fastMode: true })
  })

  it('falls back to the global model when the profile model left the catalog', () => {
    expect(resolveAgentLaunchDefaults({ catalog: CLAUDE, base, profile: { model: 'retired', effort: 'high' } }))
      .toEqual({ model: 'sonnet', effort: 'high' })
  })

  it('passes validated profile values through when no catalog is cached', () => {
    expect(resolveAgentLaunchDefaults({ catalog: { models: [] }, base: {}, profile: { model: 'opus', context: '1m', effort: 'max' } }))
      .toEqual({ model: 'opus[1m]', effort: 'max' })
  })

  it('is overridden by explicit launch arguments spread over it', () => {
    const defaults = resolveAgentLaunchDefaults({ catalog: CLAUDE, base, profile: { model: 'opus', effort: 'max' } })
    expect({ ...defaults, ...{ effort: 'low' } }).toEqual({ model: 'opus', effort: 'low' })
  })
})
