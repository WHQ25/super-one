/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BUILTIN_PLATFORMS, type Credential } from '@superone/shared/platform-registry'
import type { ModelOption } from '@superone/shared/agent-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { PreferencesPage } from './PreferencesPage'

const MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Most capable', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', name: 'Sonnet 5', description: 'Balanced', supportedEffortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-5', name: 'Haiku 5', description: 'Fast' },
]

const GLM_CREDENTIAL: Credential = {
  id: 'glm',
  platformId: 'zhipu-cn',
  planId: 'coding',
  name: 'Work',
  secret: '',
  notes: '',
  sortOrder: 0,
}

function freshClaudePrefs() {
  return {
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'high' as const,
    defaultPermissionMode: '' as const,
    defaultSandboxMode: '' as const,
    askUserQuestionPreviewFormat: 'markdown' as const,
    drawModInterfaces: true,
    modDevFolders: [] as string[],
  }
}

const originalFetchProviderData = useSettingsStore.getState().fetchProviderData
const saveAppSettings = vi.fn()

function rowButton(label: string): HTMLButtonElement {
  const row = screen.getByText(label).parentElement?.parentElement?.parentElement
  const button = row?.querySelector('button')
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing control for ${label}`)
  return button
}

beforeEach(() => {
  const claudePrefs = freshClaudePrefs()
  saveAppSettings.mockReset()
  saveAppSettings.mockImplementation(async (patch: { agentPreference?: { claude?: Partial<typeof claudePrefs> } }) => {
    Object.assign(claudePrefs, patch.agentPreference?.claude ?? {})
    return { agentPreference: { claude: { ...claudePrefs } } }
  })
  Object.assign(window.app, {
    getAppSettings: async () => ({ agentPreference: { claude: { ...claudePrefs } } }),
    saveAppSettings,
  } as never)
  useAppStore.setState({
    currentFolder: null,
    experimentalClaudeOpenAiChatEnabled: false,
    selectedHostConnectionId: 'local',
  })
  useChatStore.setState({
    activeProject: null,
    harnessResources: {
      ...useChatStore.getState().harnessResources,
      claude: {
        models: MODELS,
        account: {},
        slashCommands: [],
        skills: [],
        commands: [],
        agents: [],
        outputStyles: [],
      },
    },
  })
  useSettingsStore.setState({
    platforms: [],
    credentials: [],
    bindings: [],
    providerScope: 'local',
    fetchProviderData: async () => {},
  })
})

afterEach(() => {
  cleanup()
  delete (window.app as { getAppSettings?: unknown }).getAppSettings
  delete (window.app as { saveAppSettings?: unknown }).saveAppSettings
  useSettingsStore.setState({
    platforms: [],
    credentials: [],
    bindings: [],
    fetchProviderData: originalFetchProviderData,
  })
  useChatStore.setState({
    harnessResources: {
      ...useChatStore.getState().harnessResources,
      claude: null,
    },
  })
})

function bindGlm() {
  useSettingsStore.setState({
    platforms: BUILTIN_PLATFORMS.filter((platform) => platform.id === 'zhipu-cn'),
    credentials: [GLM_CREDENTIAL],
    bindings: [{ consumer: 'chat:claude', credentialId: 'glm' }],
  })
}

describe('Claude preferences provider mapping', () => {
  it('shows the official model name and its effort when no provider mapping is active', async () => {
    render(<PreferencesPage provider="claude" />)

    await waitFor(() => {
      expect(rowButton('Default Model')).toHaveTextContent('Opus 5.5')
    })
    const effort = rowButton('Default Thinking Effort')
    expect(effort).toBeEnabled()
    expect(effort).toHaveTextContent('High')
    expect(saveAppSettings).not.toHaveBeenCalled()
  })

  it('remaps the model list and hides effort for a mapped third-party provider without clearing the saved effort', async () => {
    bindGlm()
    const user = userEvent.setup()
    render(<PreferencesPage provider="claude" />)

    await waitFor(() => {
      expect(rowButton('Default Model')).toHaveTextContent('GLM-5.3')
    })
    const effort = rowButton('Default Thinking Effort')
    expect(effort).toBeDisabled()
    expect(effort).toHaveTextContent('Default')
    expect(saveAppSettings).not.toHaveBeenCalled()

    await user.click(rowButton('Default Model'))
    expect(await screen.findByText('GLM-5.3 Flash')).toBeInTheDocument()
    expect(screen.queryByText('Most capable')).not.toBeInTheDocument()
    expect(screen.queryByText('Opus 5.5')).not.toBeInTheDocument()

    await user.click(screen.getByText('GLM-5.3 Flash'))
    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({
        agentPreference: {
          claude: {
            defaultModel: 'claude-haiku-5',
            defaultEffort: 'high',
            askUserQuestionPreviewFormat: 'markdown',
          },
        },
      })
    })
  })
})
