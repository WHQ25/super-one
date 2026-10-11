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
/** `window.environment.patchSessionSettings`: a host-owned session's settings change. */
const patchSessionSettings = vi.fn()

function session() {
  const state = useChatStore.getState()
  return state.projectSessions[PROJECT]!._sessions[state.projectSessions[PROJECT]!._activeSessionId!]!
}

/** Mark the project's active session as one its host has created. */
function hostOwned(projectPath: string) {
  useChatStore.setState((s) => {
    const project = s.projectSessions[projectPath]!
    const sid = project._activeSessionId!
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: { ...project, _sessions: { ...project._sessions, [sid]: { ...project._sessions[sid]!, hostSessionOwned: true } } },
      },
    }
  })
}

beforeEach(() => {
  selectorProps = {}
  patchSessionSettings.mockReset().mockResolvedValue({})
  Object.assign(window.environment, { patchSessionSettings })
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
    hostOwned(PROJECT)
    render(<ClaudeModelSelector />)
    expect(selectorProps.optionParams).toEqual([expect.objectContaining({ id: 'ultracode', selected: 'false' })])

    act(() => selectorProps.onOptionParamChange?.('ultracode', 'true'))

    expect(session().ultracode).toBe(true)
    expect(patchSessionSettings).toHaveBeenCalledWith('local', useChatStore.getState().projectSessions[PROJECT]!._activeSessionId, { ultracode: true })
  })

  it('hides Ultracode and turns it off when the model has no xhigh effort', () => {
    useChatStore.getState().setUltracode(true)
    render(<ClaudeModelSelector />)

    act(() => useChatStore.getState().setSelectedModel('haiku'))

    expect(selectorProps.optionParams).toEqual([])
    expect(session().ultracode).toBe(false)
  })

  it('offers Ultracode on a remote project draft, which keeps it for its first send', () => {
    const remote = 'remote:conn-1:/srv/app'
    useChatStore.getState().ensureSession(remote)
    useChatStore.setState((s) => ({
      activeProject: remote,
      projectSessions: { ...s.projectSessions, [remote]: { ...s.projectSessions[remote]!, claudeModels: [OPUS] } },
    }))
    useChatStore.getState().setSelectedModel('opus')
    render(<ClaudeModelSelector />)
    patchSessionSettings.mockClear()

    act(() => selectorProps.onOptionParamChange?.('ultracode', 'true'))

    const state = useChatStore.getState().projectSessions[remote]!
    expect(state._sessions[state._activeSessionId!]!.ultracode).toBe(true)
    expect(patchSessionSettings).not.toHaveBeenCalled()
  })

  it("sends the switch to the node running a remote session", () => {
    const remote = 'remote:conn-1:/srv/app'
    useChatStore.getState().ensureSession(remote)
    useChatStore.setState((s) => ({
      activeProject: remote,
      projectSessions: { ...s.projectSessions, [remote]: { ...s.projectSessions[remote]!, claudeModels: [OPUS] } },
    }))
    hostOwned(remote)
    useChatStore.getState().setSelectedModel('opus')
    render(<ClaudeModelSelector />)
    patchSessionSettings.mockClear()

    act(() => selectorProps.onOptionParamChange?.('ultracode', 'true'))

    const state = useChatStore.getState().projectSessions[remote]!
    expect(patchSessionSettings).toHaveBeenCalledWith('conn-1', state._activeSessionId, { ultracode: true })
  })
})
