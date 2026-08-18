/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ModelOption } from '@superone/shared/agent-types'

interface SelectorProps {
  models: Array<{ id: string; name: string; description?: string }>
  selectedModelId: string | null
  selectedModelLabel?: string | null
  onSelectModel: (id: string) => void
  effortOptions: Array<{ value: string; label: string }>
  selectedEffort: string | null
  onSelectEffort: (value: string) => void
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

function seedStore(resources: { models: ModelOption[] } | null): void {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    harnessResources: {
      claude: null,
      codex: null,
      acp: null,
      opencode: null,
      cursor: null,
      deepseek: resources,
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

async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  groupedSelectorSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DeepseekModelSelector', () => {
  it('renders the graceful placeholder for null and empty resources', () => {
    seedStore(null)
    const { unmount } = render(<DeepseekModelSelector />)

    expect(screen.getByText('DeepSeek')).toHaveClass(
      'rounded-lg',
      'px-2',
      'py-1',
      'text-xs',
      'text-muted-foreground',
    )
    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()

    unmount()
    seedStore({ models: [] })
    render(<DeepseekModelSelector />)

    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
  })

  it('renders catalog models and dispatches a selected model', () => {
    seedStore({ models: MODELS })
    const setSelectedModel = vi.fn(realSetSelectedModel)
    useChatStore.setState({ setSelectedModel })

    render(<DeepseekModelSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek Reasoner' }))

    expect(setSelectedModel).toHaveBeenCalledOnce()
    expect(setSelectedModel).toHaveBeenCalledWith('deepseek-reasoner')
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
    expect(setSelectedEffort).toHaveBeenCalledWith('high')
  })

  it('does not create a store-write storm while deriving the default', async () => {
    seedStore({ models: MODELS })
    const setSelectedModel = vi.fn(realSetSelectedModel)
    useChatStore.setState({ setSelectedModel })

    render(<DeepseekModelSelector />)
    await settle()

    expect(setSelectedModel.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
