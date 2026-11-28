import { describe, expect, it, vi } from 'vitest'
import type {
  AppSettings,
  HarnessId,
  HarnessResourcesMap,
  ModelOption,
} from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import {
  buildRemoteHarnessSystemInfo,
  type RemoteHarnessSystemInfoDependencies,
} from './remote-harness-system-info'

function model(id: string, extra: Partial<ModelOption> = {}): ModelOption {
  return { id, name: id, description: '', ...extra }
}

/** Per-harness permission modes, since each harness now owns its own. */
type PermissionModes = Partial<Record<HarnessId, string>>

function settings(permissionModes: PermissionModes = {}): AppSettings {
  return {
    experimentalClaudeOpenAiChatEnabled: false,
    agentPreference: {
      claude: {
        defaultModel: '',
        defaultEffort: '',
        defaultPermissionMode: permissionModes.claude ?? '',
        defaultSandboxMode: '',
      },
      codex: {
        defaultModel: 'codex-model',
        defaultReasoningEffort: 'high',
        defaultPermissionPreset: 'full-access',
      },
      'acp-grok': { defaultModel: '', defaultEffort: '', defaultPermissionMode: permissionModes['acp-grok'] ?? '', brandHue: null, tokenOverrides: {} },
      'acp-antigravity': { defaultModel: '', defaultEffort: '', defaultPermissionMode: permissionModes['acp-antigravity'] ?? '', brandHue: null, tokenOverrides: {} },
      cursor: { defaultPermissionMode: permissionModes.cursor ?? '', defaultSandboxMode: '' },
      dsh: { defaultPermissionMode: permissionModes.dsh ?? '' },
      opencode: { defaultPermissionMode: permissionModes.opencode ?? '' },
    },
  } as AppSettings
}

function dependencies(
  resources: Partial<HarnessResourcesMap>,
  permissionModes: PermissionModes = {},
): RemoteHarnessSystemInfoDependencies {
  const getCachedResources = (<H extends HarnessId>(harnessId: H) => (
    resources[harnessId] ?? null
  )) as RemoteHarnessSystemInfoDependencies['getCachedResources']
  return {
    settings: settings(permissionModes),
    getCachedResources,
    fetchClaudeModels: vi.fn(async () => []),
    connectOpenCodeResources: vi.fn(async () => resources.opencode ?? { models: [], agents: [], commands: [] }),
    listCodexModels: vi.fn(async () => []),
    codexAccount: vi.fn(() => null),
    activeProvider: vi.fn(() => null),
  }
}

describe('remote harness system info', () => {
  it('advertises voice before a Codex session exists, independently of the default account', async () => {
    const deps = dependencies({ codex: { models: [], prompts: [] } })
    deps.activeProvider = vi.fn(() => ({ id: 'custom', type: 'custom' }) as never)
    expect((await buildRemoteHarnessSystemInfo('/project', 'codex', deps)).realtimeVoice)
      .toEqual({ protocol: 1, supported: true })
    expect((await buildRemoteHarnessSystemInfo('/project', 'claude', dependencies({}))).realtimeVoice)
      .toEqual({ protocol: 1, supported: false })
  })

  it.each([
    ['opencode', []],
    ['cursor', ['agent', 'plan', 'bypassPermissions']],
    ['dsh', ['plan', 'default', 'bypassPermissions']],
  ] as const)('keeps %s on its own model and permission catalog', async (harnessId, permissionModes) => {
    const resources = {
      opencode: { models: [model('opencode-model')], agents: [], commands: [] },
      cursor: { models: [model('cursor-model')], user: null },
      dsh: { models: [model('dsh-model')] },
    } satisfies Partial<HarnessResourcesMap>

    const info = await buildRemoteHarnessSystemInfo('/project', harnessId, dependencies(resources))

    expect(info.models?.map((entry) => entry.id)).toEqual([`${harnessId}-model`])
    expect(info.permissionModes).toEqual(permissionModes)
    expect(info.slashCommands).toEqual([])
  })

  it('projects the selected ACP agent model, effort, and slash catalog', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-grok', dependencies({
      'acp-grok': {
        agents: [{ id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' }],
        selectedAgentId: 'grok-build',
        configByAgentId: {
          'grok-build': {
            configOptions: [],
            extraModels: [model('grok-model')],
            selectedModelId: 'grok-model',
            modelConfigId: null,
            extraModes: [model('fast'), model('deep')],
            selectedModeId: 'deep',
            modeConfigId: null,
            slashCommands: [{
              name: 'web',
              description: 'Search the web',
              argumentHint: '',
              isSkill: false,
            }],
            updatedAt: '2026-09-04T00:00:00.000Z',
          },
        },
      },
    }))

    expect(info.acpAgentId).toBe('grok-build')
    expect(info.models?.map((entry) => entry.id)).toEqual(['grok-model'])
    expect(info.efforts?.map((entry) => entry.value)).toEqual(['fast', 'deep'])
    expect(info.defaults).toMatchObject({ model: 'grok-model', effort: 'deep' })
    expect(info.slashCommands?.map((entry) => entry.name)).toEqual(['web'])
    expect(info.permissionModes).toEqual(HARNESS_LAUNCH_OPTIONS['acp-grok'].permissionModes)
  })

  it('honors an explicit acpAgentId and projects Antigravity permission modes without redundant session modes', async () => {
    const deps = dependencies({
      'acp-antigravity': {
        agents: [
          { id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' },
          { id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy' },
        ],
        selectedAgentId: 'grok-build',
        configByAgentId: {
          antigravity: {
            configOptions: [],
            extraModels: [model('gemini-3.1-pro-high')],
            selectedModelId: 'gemini-3.1-pro-high',
            modelConfigId: null,
            extraModes: [model('agent'), model('plan')],
            selectedModeId: 'agent',
            modeConfigId: null,
            slashCommands: [{
              name: 'automation',
              description: 'Create an automation',
              argumentHint: '',
              isSkill: true,
            }],
            updatedAt: '2026-09-04T00:00:00.000Z',
          },
        },
      },
    }, { 'acp-antigravity': 'auto' })
    deps.acpAgentId = 'antigravity'

    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-antigravity', deps)

    expect(info.acpAgentId).toBe('antigravity')
    expect(info.models?.map((entry) => entry.id)).toEqual(['gemini-3.1-pro-high'])
    expect(info.permissionModes).toEqual(['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions'])
    expect(info.defaults).toMatchObject({ model: 'gemini-3.1-pro-high', permissionMode: 'auto' })
    expect(info.modes).toBeUndefined()
    expect(info.slashCommands?.map((entry) => entry.name)).toEqual(['automation'])
  })

  /**
   * The point of the per-harness split: a mode configured on one harness must
   * reach that harness and no other. The previous shared setting could only ever
   * be right for the harness it was written for.
   */
  it.each([
    ['acp-grok', 'auto'],
    ['opencode', 'acceptEdits'],
    ['dsh', 'plan'],
    ['cursor', 'agent'],
  ] as const)('carries %s its own configured permission mode', async (harnessId, mode) => {
    const resources = {
      'acp-grok': {
        agents: [{ id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' }],
        selectedAgentId: 'grok-build',
        configByAgentId: {
          'grok-build': {
            configOptions: [],
            extraModels: [model('grok-model')],
            selectedModelId: 'grok-model',
            modelConfigId: null,
            extraModes: [],
            selectedModeId: null,
            modeConfigId: null,
            slashCommands: [],
            updatedAt: '2026-09-04T00:00:00.000Z',
          },
        },
      },
      opencode: { models: [model('opencode-model')], agents: [], commands: [] },
      dsh: { models: [model('dsh-model')] },
      cursor: { models: [model('cursor-model')], user: null },
    } satisfies Partial<HarnessResourcesMap>

    const info = await buildRemoteHarnessSystemInfo(
      '/project',
      harnessId,
      dependencies(resources, { [harnessId]: mode }),
    )

    expect(info.defaults?.permissionMode).toBe(harnessId === 'opencode' ? 'default' : mode)
  })

  /** Claude's setting is Claude's alone now — it must not reach another harness. */
  it('does not leak the Claude permission mode onto another harness', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'dsh', dependencies(
      { dsh: { models: [model('dsh-model')] } },
      { claude: 'auto' },
    ))

    expect(info.defaults?.permissionMode).toBe(HARNESS_LAUNCH_OPTIONS.dsh.defaultPermissionMode)
  })

  /** A stored mode the harness has no spelling for degrades to its first one. */
  it('drops a permission mode the harness does not offer', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'dsh', dependencies(
      { dsh: { models: [model('dsh-model')] } },
      { dsh: 'acceptEdits' },
    ))

    expect(info.defaults?.permissionMode).toBe('default')
  })

  it('normalizes Codex defaults while retaining legacy aliases', async () => {
    const deps = dependencies({
      codex: { models: [], prompts: [] },
    })
    deps.listCodexModels = vi.fn(async () => [model('codex-model', {
      supportedReasoningEfforts: [
        { value: 'medium', description: 'Balanced' },
        { value: 'high', description: 'Deep' },
      ],
    })])

    const info = await buildRemoteHarnessSystemInfo('/project', 'codex', deps)

    expect(info.defaults).toEqual({
      model: 'codex-model',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      reasoningEffort: 'high',
      permissionPreset: 'full-access',
    })
    expect(info.permissionModes).toEqual(['default', 'auto', 'bypassPermissions'])
    expect(info.permissionPresets).toEqual(['read-only', 'default', 'auto-review', 'full-access'])
  })

  it.each(['claude', 'cursor'] as const)('resolves %s model context windows from the host catalog', async (harnessId) => {
    const deps = dependencies({
      claude: { models: [model('opus', { resolvedModel: 'claude-opus-5-5' }), model('haiku')] },
      cursor: { models: [model('claude-opus-5-5', { contextWindow: 200_000 })] },
    } as Partial<HarnessResourcesMap>)
    deps.catalogModels = async () => new Map([['claude-opus-5-5', { contextWindow: 1_000_000 }]])

    const info = await buildRemoteHarnessSystemInfo('/repo', harnessId, deps)

    expect(info.models.map((entry) => entry.contextWindow)).toEqual(
      harnessId === 'claude' ? [1_000_000, undefined] : [200_000],
    )
  })

  it('projects Antigravity per-model effort levels and clamps default effort to the active model', async () => {
    const deps = dependencies({
      'acp-antigravity': {
        agents: [{ id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy acp' }],
        selectedAgentId: 'antigravity',
        configByAgentId: {
          antigravity: {
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: 'gemini-4-carbon',
                options: [
                  { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
                  { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                  { value: 'gemini-pro-orchestrator', name: 'Gemini Pro Orchestrator' },
                ],
              },
              {
                id: 'thought_level',
                name: 'Thinking Level',
                category: 'thought_level',
                type: 'select',
                currentValue: 'xhigh',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'medium', name: 'Medium' },
                  { value: 'high', name: 'High' },
                ],
              },
            ],
            extraModels: [
              model('gemini-4-hydrogen-low'),
              model('gemini-4-hydrogen-medium'),
              model('gemini-4-hydrogen-high'),
              model('gemini-4-hydrogen-xhigh'),
              model('gemini-4-carbon-low'),
              model('gemini-4-carbon-medium'),
              model('gemini-4-carbon-high'),
              model('gemini-pro-orchestrator'),
            ],
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
        },
      },
    })

    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-antigravity', deps)
    expect(info.efforts?.map((e) => e.value)).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(info.defaults?.model).toBe('gemini-4-carbon')
    expect(info.defaults?.effort).toBe('high')
    expect(info.models.find((m) => m.id === 'gemini-pro-orchestrator')?.supportsEffort).toBe(false)
  })

  it('honors configured Antigravity defaultModel and defaultEffort over ACP session defaults', async () => {
    const deps = dependencies({
      'acp-antigravity': {
        agents: [{ id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy acp' }],
        selectedAgentId: 'antigravity',
        configByAgentId: {
          antigravity: {
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: 'gemini-4-carbon',
                options: [
                  { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
                  { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                ],
              },
              {
                id: 'thought_level',
                name: 'Thinking Level',
                category: 'thought_level',
                type: 'select',
                currentValue: 'low',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'medium', name: 'Medium' },
                  { value: 'high', name: 'High' },
                ],
              },
            ],
            extraModels: [
              model('gemini-4-hydrogen-low'),
              model('gemini-4-hydrogen-medium'),
              model('gemini-4-hydrogen-high'),
              model('gemini-4-hydrogen-xhigh'),
              model('gemini-4-carbon-low'),
              model('gemini-4-carbon-medium'),
              model('gemini-4-carbon-high'),
            ],
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
        },
      },
    })
    deps.settings.agentPreference['acp-antigravity'].defaultModel = 'gemini-4-hydrogen'
    deps.settings.agentPreference['acp-antigravity'].defaultEffort = 'xhigh'

    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-antigravity', deps)
    expect(info.defaults?.model).toBe('gemini-4-hydrogen')
    expect(info.defaults?.effort).toBe('xhigh')
  })

  it('resolves suffixed Antigravity model variants from configured base model and effort', async () => {
    const deps = dependencies({
      'acp-antigravity': {
        agents: [{ id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy acp' }],
        selectedAgentId: 'antigravity',
        configByAgentId: {
          antigravity: {
            configOptions: [],
            extraModels: [
              model('gemini-4-hydrogen-low'),
              model('gemini-4-hydrogen-high'),
              model('gemini-4-carbon-medium'),
            ],
            selectedModelId: 'gemini-4-carbon-medium',
            modelConfigId: null,
            extraModes: [],
            selectedModeId: null,
            modeConfigId: null,
            slashCommands: [],
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
        },
      },
    })
    deps.settings.agentPreference['acp-antigravity'].defaultModel = 'gemini-4-hydrogen'
    deps.settings.agentPreference['acp-antigravity'].defaultEffort = 'high'

    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-antigravity', deps)
    expect(info.defaults?.model).toBe('gemini-4-hydrogen-high')
  })

  it('honors configured Grok defaultModel and defaultEffort', async () => {
    const deps = dependencies({
      'acp-grok': {
        agents: [{ id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' }],
        selectedAgentId: 'grok-build',
        configByAgentId: {
          'grok-build': {
            configOptions: [],
            extraModels: [model('grok-4'), model('grok-4.20')],
            selectedModelId: 'grok-4',
            modelConfigId: null,
            extraModes: [model('low'), model('high')],
            selectedModeId: 'low',
            modeConfigId: 'reasoning_effort',
            slashCommands: [],
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
        },
      },
    })
    deps.settings.agentPreference['acp-grok'].defaultModel = 'grok-4.20'
    deps.settings.agentPreference['acp-grok'].defaultEffort = 'high'

    const info = await buildRemoteHarnessSystemInfo('/project', 'acp-grok', deps)
    expect(info.defaults).toMatchObject({ model: 'grok-4.20', effort: 'high' })
  })

  it('matches desktop fallback efforts when Claude and Codex effort preferences are unset', async () => {
    const claudeDeps = dependencies({
      claude: {
        models: [model('opus', { supportedEffortLevels: ['low', 'medium', 'high', 'max'] })],
      },
    })
    const claudeInfo = await buildRemoteHarnessSystemInfo('/project', 'claude', claudeDeps)
    expect(claudeInfo.defaults?.effort).toBe('high')

    const codexDeps = dependencies({ codex: { models: [], prompts: [] } })
    codexDeps.settings.agentPreference.codex.defaultReasoningEffort = ''
    codexDeps.listCodexModels = vi.fn(async () => [model('codex-model', {
      supportedReasoningEfforts: [
        { value: 'low', description: '' },
        { value: 'medium', description: '' },
        { value: 'xhigh', description: '' },
      ],
    })])
    const codexInfo = await buildRemoteHarnessSystemInfo('/project', 'codex', codexDeps)
    expect(codexInfo.defaults?.effort).toBe('xhigh')
  })
})
