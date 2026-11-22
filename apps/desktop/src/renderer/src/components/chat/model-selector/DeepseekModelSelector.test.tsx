/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DeepseekPresetRoster, ModelOption } from '@superone/shared/agent-types'

interface SelectorProps {
  models: Array<{ id: string; name: string; description?: string }>
  selectedModelId: string | null
  selectedModelLabel?: string | null
  onSelectModel: (id: string) => void
  effortOptions: Array<{ value: string; label: string }>
  selectedEffort: string | null
  onSelectEffort: (value: string) => void
  modes: Array<{ id: string; name: string; description?: string }>
  selectedModeId: string | null
  onSelectMode: (id: string) => void
  modesDisabled: boolean
}

const { groupedSelectorSpy } = vi.hoisted(() => ({
  groupedSelectorSpy: vi.fn(),
}))

vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: (props: SelectorProps) => {
    groupedSelectorSpy(props)
    return (
      <div data-testid="model-selector">
        {props.models.map((model) => (
          <button key={model.id} onClick={() => props.onSelectModel(model.id)}>
            {model.name}
          </button>
        ))}
        {props.effortOptions.map((effort) => (
          <button key={effort.value} onClick={() => props.onSelectEffort(effort.value)}>
            {effort.label}
          </button>
        ))}
        {props.modes.map((mode) => (
          <button key={mode.id} onClick={() => props.onSelectMode(mode.id)}>
            {mode.name}
          </button>
        ))}
      </div>
    )
  },
}))

import { DeepseekModelSelector } from './DeepseekModelSelector'
import { useChatStore } from '@/stores/chat'

const realSetSelectedModel = useChatStore.getState().setSelectedModel
const realSetSelectedEffort = useChatStore.getState().setSelectedEffort

const MODELS: ModelOption[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'Default model' },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    description: 'Reasoning model',
    supportedEffortLevels: ['low', 'high'],
  },
]

const PRESETS: DeepseekPresetRoster = {
  presets: [
    { id: 'standard', name: '标准模式', description: '标准模式说明', order: 1, broken: null },
    { id: 'minimal', name: '极简模式', description: '极简模式说明', order: 2, broken: null },
  ],
  current: null,
  switchable: true,
}

const listPresets = vi.fn<() => Promise<DeepseekPresetRoster>>()
const setPreset = vi.fn<() => Promise<{ ok: boolean }>>()
const connectDeepseek = vi.fn<() => Promise<{ models: ModelOption[] }>>()
const listPlatforms = vi.fn<() => Promise<unknown[]>>()
const listCredentials = vi.fn<() => Promise<unknown[]>>()
const listBindings = vi.fn<() => Promise<unknown[]>>()

function seedStore(resources: { models: ModelOption[] } | null): void {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    harnessResources: {
      claude: null,
      codex: null,
      'acp-grok': null, 'acp-antigravity': null,
      opencode: null,
      cursor: null,
      dsh: resources,
    },
    setSelectedModel: realSetSelectedModel,
    setSelectedEffort: realSetSelectedEffort,
  })
  useChatStore.getState().ensureSession('/deepseek')
  useChatStore.setState({ activeProject: '/deepseek' })
}

function latestSelectorProps(): SelectorProps {
  return groupedSelectorSpy.mock.calls.at(-1)?.[0] as SelectorProps
}

function markActiveSessionStarted(): void {
  const state = useChatStore.getState()
  const project = state.projectSessions['/deepseek']
  const sessionId = project._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      '/deepseek': {
        ...project,
        _sessions: {
          ...project._sessions,
          [sessionId]: {
            ...project._sessions[sessionId],
            messages: [{ id: 'user-1' } as never],
          },
        },
      },
    },
  })
}

async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  groupedSelectorSpy.mockClear()
  listPresets.mockReset().mockResolvedValue(PRESETS)
  setPreset.mockReset().mockResolvedValue({ ok: true })
  connectDeepseek.mockReset().mockResolvedValue({ models: [] })
  listPlatforms.mockReset().mockResolvedValue([])
  listCredentials.mockReset().mockResolvedValue([])
  listBindings.mockReset().mockResolvedValue([])
  Object.assign(window, {
    app: {
      ...window.app,
      listDeepseekPresets: listPresets,
      setDeepseekPreset: setPreset,
      connectDeepseek,
      listPlatforms,
      listCredentials,
      listBindings,
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DeepseekModelSelector', () => {
  it('renders the selector with DeepSeek label for null and empty resources', () => {
    seedStore(null)
    const { unmount } = render(<DeepseekModelSelector />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(latestSelectorProps()).toMatchObject({
      models: [],
      selectedModelLabel: 'DeepSeek',
    })

    unmount()
    seedStore({ models: [] })
    render(<DeepseekModelSelector />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(latestSelectorProps()).toMatchObject({
      models: [],
      selectedModelLabel: 'DeepSeek',
    })
  })

  it('renders catalog models and dispatches a selected model', () => {
    seedStore({ models: MODELS })
    const setSelectedModel = vi.fn(realSetSelectedModel)
    useChatStore.setState({ setSelectedModel })

    render(<DeepseekModelSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek Reasoner' }))

    expect(setSelectedModel).toHaveBeenCalledOnce()
    expect(setSelectedModel).toHaveBeenCalledWith('deepseek-reasoner', undefined)
    const state = useChatStore.getState()
    const project = state.projectSessions['/deepseek']
    expect(project._sessions[project._activeSessionId!].selectedModel).toBe('deepseek-reasoner')
  })

  it('derives deepseek-v4-pro as the effective selection without writing it', () => {
    seedStore({ models: MODELS })
    const setSelectedModel = vi.fn(realSetSelectedModel)
    useChatStore.setState({ setSelectedModel })

    render(<DeepseekModelSelector />)

    expect(latestSelectorProps().selectedModelId).toBe('deepseek-v4-pro')
    expect(latestSelectorProps().selectedModelLabel).toBe('DeepSeek V4 Pro')
    expect(setSelectedModel).not.toHaveBeenCalled()
  })

  it('only exposes effort options from the effective model and dispatches effort changes', () => {
    seedStore({ models: MODELS })
    const setSelectedEffort = vi.fn(realSetSelectedEffort)
    useChatStore.setState({ setSelectedEffort })

    render(<DeepseekModelSelector />)

    expect(latestSelectorProps().effortOptions).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek Reasoner' }))
    expect(latestSelectorProps().effortOptions).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'High' }))
    expect(setSelectedEffort).toHaveBeenCalledWith('high', undefined)
  })

  it('does not create a store-write storm while deriving the default', async () => {
    seedStore({ models: MODELS })
    const setSelectedModel = vi.fn(realSetSelectedModel)
    useChatStore.setState({ setSelectedModel })

    render(<DeepseekModelSelector />)
    await settle()

    expect(setSelectedModel.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('merges translated preset modes into the selector and records a draft pick', async () => {
    seedStore({ models: MODELS })
    render(<DeepseekModelSelector />)
    await settle()

    expect(latestSelectorProps().modes.map((mode) => mode.name)).toEqual(['Standard', 'Minimal'])
    expect(latestSelectorProps().selectedModeId).toBe('standard')
    expect(latestSelectorProps().modesDisabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Minimal' }))

    const state = useChatStore.getState()
    const project = state.projectSessions['/deepseek']
    expect(project._sessions[project._activeSessionId!].dshPreset).toBe('minimal')
    expect(setPreset).not.toHaveBeenCalled()
  })

  it('exposes the current preset as fixed after the first turn starts', async () => {
    seedStore({ models: MODELS })
    markActiveSessionStarted()
    render(<DeepseekModelSelector />)
    await settle()

    expect(latestSelectorProps().selectedModeId).toBe('standard')
    expect(latestSelectorProps().modesDisabled).toBe(true)
  })
})
