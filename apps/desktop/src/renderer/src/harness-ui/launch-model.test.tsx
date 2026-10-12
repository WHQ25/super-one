/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { HarnessId, ModelOption, SessionAgentProfile } from '@superone/shared/agent-types'
import type { LaunchModelProps } from './launch-model'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// The launch controls are judged by what they hand the shared picker.
let picker: Record<string, unknown> = {}
vi.mock('@/components/chat/model-selector/GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: (props: Record<string, unknown>) => {
    picker = props
    return null
  },
}))

const { HARNESS_CONTROLS } = await import('./controls')
const { mergeCollabProviders } = await import('./launch-model')
const { claudeModelsForProvider } = await import('./claude/launch-model')
const { codexModelsToSelectorOptions } = await import('./codex/launch-model')
const { useChatStore } = await import('@/stores/chat')
const { useSettingsStore } = await import('@/stores/settings')

const model = (id: string, extra: Partial<ModelOption> = {}): ModelOption => ({ id, name: id, description: '', ...extra })
const values = (key: 'effortOptions' | 'models') => (picker[key] as Array<{ value?: string; id?: string }>).map((o) => o.value ?? o.id)

function profile(harnessId: HarnessId, extra: Partial<SessionAgentProfile> = {}): SessionAgentProfile {
  return {
    id: harnessId,
    name: harnessId,
    harnessId,
    brandKey: harnessId,
    defaultConfig: {},
    models: [{ id: 'from-profile', name: 'From Profile' }],
    efforts: [],
    apiProviders: [],
    ...extra,
  }
}

function Row({ harnessId, ...props }: { harnessId: HarnessId } & Partial<LaunchModelProps>) {
  const { LaunchModelControl } = HARNESS_CONTROLS[harnessId]
  return (
    <LaunchModelControl
      profile={undefined}
      catalog="local"
      apiProviderId={null}
      model={null}
      effort={null}
      onChange={() => {}}
      {...props}
    />
  )
}

function setAcp(agentId: string, catalog: { models?: ModelOption[]; extraModes?: ModelOption[]; configOptions?: unknown[] }) {
  useChatStore.setState((state) => ({
    harnessResources: {
      ...state.harnessResources,
      acp: {
        agents: [],
        selectedAgentId: agentId,
        configByAgentId: { [agentId]: { configOptions: [], extraModels: catalog.models ?? [], ...catalog } },
      } as never,
    },
  }))
}

beforeEach(() => {
  picker = {}
  useSettingsStore.setState({ fetchProviderData: async () => {}, setProviderScope: () => {} } as never)
  useChatStore.setState((state) => ({
    harnessResources: { ...state.harnessResources, claude: null, acp: null, opencode: null, cursor: null, dsh: null } as never,
  }))
})

describe('launch model controls', () => {
  it('remounts cleanly while one row switches through every harness', () => {
    const { rerender } = render(<Row harnessId="claude" />)
    for (const harnessId of ['codex', 'acp', 'opencode', 'cursor', 'dsh', 'claude'] as const) {
      rerender(<Row harnessId={harnessId} />)
      expect(picker.selectedModelId).toBeNull()
    }
  })

  it('fills in when the profile arrives after the first paint', () => {
    const { rerender } = render(<Row harnessId="dsh" />)
    expect(values('models')).toEqual([])
    rerender(<Row harnessId="dsh" profile={profile('dsh')} />)
    expect(values('models')).toEqual(['from-profile'])
  })

  it('offers the live Cursor catalog minus models disabled in harness config', () => {
    useChatStore.setState((state) => ({
      harnessResources: {
        ...state.harnessResources,
        cursor: { models: [model('composer-1'), model('retired')], disabledModelIds: ['retired'] } as never,
      },
    }))
    render(<Row harnessId="cursor" profile={profile('cursor')} />)
    expect(values('models')).toEqual(['composer-1'])
  })

  it('reads only the profile for a remote launch', () => {
    useChatStore.setState((state) => ({
      harnessResources: { ...state.harnessResources, opencode: { models: [model('live/model')], agents: [], commands: [] } },
    }))
    render(<Row harnessId="opencode" catalog="profile" profile={profile('opencode', { efforts: ['high'] })} />)
    expect(values('models')).toEqual(['from-profile'])
    expect(values('effortOptions')).toEqual(['high'])
  })
})

describe('ACP launch model', () => {
  it('shows Grok legacy modes (no config id) as effort, ascending', () => {
    setAcp('grok', { models: [model('grok-4')], extraModes: [model('high', { name: 'High Effort' }), model('low', { name: 'Low Effort' })] })
    render(<Row harnessId="acp" />)
    expect(values('models')).toEqual(['grok-4'])
    expect(values('effortOptions')).toEqual(['low', 'high'])
  })

  it('shows a reasoning_effort config select as effort', () => {
    setAcp('grok', {
      configOptions: [
        { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'grok-4', options: [{ value: 'grok-4', name: 'Grok 4' }] },
        { id: 'reasoning_effort', name: 'Effort', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'high', name: 'High' }, { value: 'low', name: 'Low' }] },
      ],
    })
    render(<Row harnessId="acp" />)
    expect(values('effortOptions')).toEqual(['low', 'high'])
  })

  it('keeps a real session mode out of effort', () => {
    setAcp('opencode', {
      configOptions: [
        { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'a/b', options: [{ value: 'a/b', name: 'B' }] },
        { id: 'mode', name: 'Mode', type: 'select', category: 'mode', currentValue: 'build', options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }] },
      ],
    })
    render(<Row harnessId="acp" acpAgentId="opencode" />)
    expect(picker.effortOptions).toEqual([])
  })

  it('groups the ACP OpenCode agent’s provider/model ids by provider', () => {
    setAcp('opencode', { models: [model('anthropic/opus'), model('openai/gpt')] })
    render(<Row harnessId="acp" acpAgentId="opencode" model="openai/gpt" />)
    expect(picker.models).toBeUndefined()
    expect((picker.modelGroups as Array<{ id: string }>).map((group) => group.id)).toEqual(['anthropic', 'openai'])
  })
})

describe('mergeCollabProviders', () => {
  it('always leads with Default and merges live keys over profile entries', () => {
    const providers = mergeCollabProviders({
      defaultBrand: 'claude',
      profileProviders: [
        { id: 'stale', name: 'Stale Name', brand: 'openai', keyName: 'old' },
        { id: 'profile-only', name: 'Profile Only', keyName: 'p' },
      ],
      live: [
        { id: 'stale', name: 'Fresh Name', brand: 'openai', keyName: 'new' },
        { id: 'live-only', name: 'Live Only', brand: 'deepseek', keyName: 'l' },
      ],
      defaultLabel: 'Claude Code (Official)',
    })

    expect(providers[0]).toEqual({ id: null, brand: 'claude', name: 'Claude Code (Official)' })
    expect(providers.find((p) => p.id === 'stale')).toEqual({ id: 'stale', name: 'Fresh Name', brand: 'openai', keyName: 'new' })
    expect(providers.find((p) => p.id === 'profile-only')).toMatchObject({ id: 'profile-only' })
    expect(providers.find((p) => p.id === 'live-only')).toMatchObject({ id: 'live-only' })
  })
})

describe('claudeModelsForProvider', () => {
  const catalog: ModelOption[] = [
    { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { id: 'claude-opus-4-5', name: 'Opus 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  ]

  it('keeps catalog labels when no model mapping is active', () => {
    expect(claudeModelsForProvider(catalog, null)).toEqual([
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
      { id: 'claude-opus-4-5', name: 'Opus 4.5' },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
    ])
  })

  it('remaps Claude slots to third-party model names like the chat selector', () => {
    const mapped = claudeModelsForProvider(catalog, {
      sonnet: { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      opus: { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      haiku: { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    })
    // Identical mapped ids collapse to one entry (same as main chat selector).
    expect(mapped).toEqual([
      { id: 'claude-sonnet-4-5', name: 'DeepSeek Chat' },
      { id: 'claude-opus-4-5', name: 'DeepSeek Reasoner' },
    ])
  })
})

describe('codexModelsToSelectorOptions', () => {
  it('formats codex model ids like the chat selector', () => {
    expect(codexModelsToSelectorOptions([
      { id: 'gpt-5.4', name: 'gpt-5.4', description: '' },
      { id: 'custom-model', name: 'My Custom', description: 'x' },
    ])).toEqual([
      { id: 'gpt-5.4', name: 'GPT5.4' },
      { id: 'custom-model', name: 'My Custom', description: 'x' },
    ])
  })
})
