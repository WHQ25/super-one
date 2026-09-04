import { describe, expect, it, vi } from 'vitest'
import type {
  AppSettings,
  HarnessId,
  HarnessResourcesMap,
  ModelOption,
} from '@superone/shared/agent-types'
import {
  buildRemoteHarnessSystemInfo,
  REMOTE_HARNESS_PERMISSION_MODES,
  type RemoteHarnessSystemInfoDependencies,
} from './remote-harness-system-info'

function model(id: string, extra: Partial<ModelOption> = {}): ModelOption {
  return { id, name: id, description: '', ...extra }
}

function settings(): AppSettings {
  return {
    experimentalClaudeOpenAiChatEnabled: false,
    agentPreference: {
      claude: {
        defaultModel: '',
        defaultEffort: '',
        defaultPermissionMode: '',
        defaultSandboxMode: '',
      },
      codex: {
        defaultModel: 'codex-model',
        defaultReasoningEffort: 'high',
        defaultPermissionPreset: 'full-access',
      },
      acp: { selectedAgentId: 'grok-build' },
    },
  } as AppSettings
}

function dependencies(
  resources: Partial<HarnessResourcesMap>,
): RemoteHarnessSystemInfoDependencies {
  const getCachedResources = (<H extends HarnessId>(harnessId: H) => (
    resources[harnessId] ?? null
  )) as RemoteHarnessSystemInfoDependencies['getCachedResources']
  return {
    settings: settings(),
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
    expect(info.permissionModes).toEqual(REMOTE_HARNESS_PERMISSION_MODES.acp)
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
