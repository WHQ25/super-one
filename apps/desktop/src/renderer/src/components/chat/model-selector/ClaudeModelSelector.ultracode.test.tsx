/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { ModelOption } from '@superone/shared/agent-types'

vi.mock('@/stores/settings', () => {
  const state = { platforms: [], credentials: [], bindings: [], providerScope: 'global', fetchProviderData: vi.fn().mockResolvedValue(undefined) }
  const useSettingsStore = (selector: (s: typeof state) => unknown) => selector(state)
  useSettingsStore.getState = () => state
  return { useSettingsStore }
})

vi.mock('@/stores/app', () => {
  const state = { experimentalClaudeOpenAiChatEnabled: false }
  const useAppStore = (selector: (s: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

vi.mock('./useSelectorProviders', () => ({ useSelectorProviders: () => ({}) }))

type SelectorProps = {
  optionParams?: Array<{ id: string; selected: string }>
  onOptionParamChange?: (id: string, value: string) => void
}
let selectorProps: SelectorProps = {}
vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: (props: SelectorProps) => {
    selectorProps = props
    return <div data-testid="model-selector" />
  },
}))

import { ClaudeModelSelector } from './ClaudeModelSelector'
import { useChatStore } from '@/stores/chat'

const PROJECT = '/ultracode-project'
const OPUS: ModelOption = { id: 'opus', name: 'Opus', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }
const HAIKU: ModelOption = { id: 'haiku', name: 'Haiku', description: '', supportedEffortLevels: ['low', 'medium', 'high'] }
const setSessionSettings = vi.fn()

function session() {
  const state = useChatStore.getState()
  return state.projectSessions[PROJECT]!._sessions[state.projectSessions[PROJECT]!._activeSessionId!]!
}

beforeEach(() => {
  selectorProps = {}
  setSessionSettings.mockReset()
  ;(window as unknown as { agent: Record<string, unknown> }).agent = { setSessionSettings }
  useChatStore.setState({
    harnessResources: {
      claude: { models: [OPUS, HAIKU], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] },
      codex: null, acp: null, opencode: null, cursor: null,
    } as never,
    claudeResourcesLoading: false,
  })
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  useChatStore.getState().setSelectedModel('opus')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ClaudeModelSelector Ultracode toggle', () => {
  it('offers Ultracode on a model with xhigh effort and sends the switch to the session', () => {
    render(<ClaudeModelSelector />)
    expect(selectorProps.optionParams).toEqual([expect.objectContaining({ id: 'ultracode', selected: 'false' })])

    act(() => selectorProps.onOptionParamChange?.('ultracode', 'true'))

    expect(session().ultracode).toBe(true)
    expect(setSessionSettings).toHaveBeenCalledWith(PROJECT, { ultracode: true }, undefined)
  })

  it('hides Ultracode and turns it off when the model has no xhigh effort', () => {
    useChatStore.getState().setUltracode(true)
    render(<ClaudeModelSelector />)

    act(() => useChatStore.getState().setSelectedModel('haiku'))

    expect(selectorProps.optionParams).toEqual([])
    expect(session().ultracode).toBe(false)
  })
})
