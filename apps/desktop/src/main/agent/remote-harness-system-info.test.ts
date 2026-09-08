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
      acp: { selectedAgentId: 'grok-build', defaultPermissionMode: permissionModes.acp ?? '' },
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
    listCodexModels: vi.fn(async () => []),
    codexAccount: vi.fn(() => null),
    activeProvider: vi.fn(() => null),
  }
}

describe('remote harness system info', () => {
  it.each([
    ['opencode', ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions']],
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
    const info = await buildRemoteHarnessSystemInfo('/project', 'acp', dependencies({
      acp: {
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
    expect(info.permissionModes).toEqual(HARNESS_LAUNCH_OPTIONS.acp.permissionModes)
  })

  /**
   * The point of the per-harness split: a mode configured on one harness must
   * reach that harness and no other. The previous shared setting could only ever
   * be right for the harness it was written for.
   */
  it.each([
    ['acp', 'auto'],
    ['opencode', 'acceptEdits'],
    ['dsh', 'plan'],
    ['cursor', 'agent'],
  ] as const)('carries %s its own configured permission mode', async (harnessId, mode) => {
    const resources = {
      acp: {
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

    expect(info.defaults?.permissionMode).toBe(mode)
  })

  /** Claude's setting is Claude's alone now — it must not reach another harness. */
  it('does not leak the Claude permission mode onto another harness', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'dsh', dependencies(
      { dsh: { models: [model('dsh-model')] } },
      { claude: 'auto' },
    ))

    expect(info.defaults?.permissionMode).toBe(HARNESS_LAUNCH_OPTIONS.dsh.permissionModes[0])
  })

  /** A stored mode the harness has no spelling for degrades to its first one. */
  it('drops a permission mode the harness does not offer', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'dsh', dependencies(
      { dsh: { models: [model('dsh-model')] } },
      { dsh: 'acceptEdits' },
    ))

    expect(info.defaults?.permissionMode).toBe('plan')
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
})
