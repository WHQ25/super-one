/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import { HarnessesSettingsPage, listKeyForSettingsProvider } from './HarnessesSettingsPage'

vi.mock('./GrokAuthSettings', () => ({ GrokAuthSettings: () => <div>grok-account</div> }))
vi.mock('./AntigravityAuthSettings', () => ({ AntigravityAuthSettings: () => <div>antigravity-account</div> }))

const hoisted = vi.hoisted(() => ({
  enableHarness: vi.fn(),
  refreshHarnessCatalog: vi.fn(),
  appState: {
    settingsProvider: 'claude' as string,
    harnessConfigSection: null as string | null,
    harnessListFocusKey: null as string | null,
  },
}))

const originalApp = window.app

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const chatMock = vi.hoisted(() => ({
  setHarnessResources: vi.fn(),
  initializeHarness: vi.fn(),
}))

vi.mock('@/stores/chat', () => {
  const state = {
    harnessResources: { acp: { agents: [] } },
    initializeHarness: chatMock.initializeHarness,
    setHarnessResources: chatMock.setHarnessResources,
  }
  return {
    useChatStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  }
})

vi.mock('@/stores/app', () => {
  const state = {
    get settingsProvider() {
      return hoisted.appState.settingsProvider
    },
    setSettingsProvider: (provider: string) => {
      hoisted.appState.settingsProvider = provider
    },
    get harnessConfigSection() {
      return hoisted.appState.harnessConfigSection
    },
    setHarnessConfigSection: (section: string | null) => {
      hoisted.appState.harnessConfigSection = section
    },
    get harnessListFocusKey() {
      return hoisted.appState.harnessListFocusKey
    },
    refreshHarnessCatalog: hoisted.refreshHarnessCatalog,
  }
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      setState: (patch: Partial<typeof hoisted.appState>) => {
        Object.assign(hoisted.appState, patch)
      },
    },
  )
  return { useAppStore }
})

vi.mock('./AgentsPage', () => ({ AgentsPage: () => null }))
vi.mock('./SkillsPage', () => ({ SkillsPage: () => null }))
vi.mock('./McpPage', () => ({ McpPage: () => null }))
vi.mock('./HooksPage', () => ({ HooksPage: () => null }))
vi.mock('./PluginsPage', () => ({ PluginsPage: () => null }))
vi.mock('./PreferencesPage', () => ({
  PreferencesPage: ({ provider }: { provider?: string }) => (
    <div>preferences-for-{provider ?? 'store'}</div>
  ),
}))
vi.mock('./CursorAuthSettings', () => ({ CursorAuthSettings: () => null }))
vi.mock('./CodexAuthSettings', () => ({ CodexAuthSettings: () => <div>Codex account settings</div> }))

describe('listKeyForSettingsProvider', () => {
  it('maps acp to the Grok catalog row', () => {
    expect(listKeyForSettingsProvider('acp')).toBe('acp-grok')
  })

  it('keeps first-party catalog ids unchanged', () => {
    expect(listKeyForSettingsProvider('claude')).toBe('claude')
    expect(listKeyForSettingsProvider('codex')).toBe('codex')
    expect(listKeyForSettingsProvider('opencode')).toBe('opencode')
    expect(listKeyForSettingsProvider('cursor')).toBe('cursor')
    expect(listKeyForSettingsProvider('dsh')).toBe('dsh')
  })
})

const HARNESS_LABELS = {
  claude: /Claude Code/i,
  codex: /^Codex/i,
  opencode: /OpenCode/i,
  cursor: /^Cursor/i,
  'acp-grok': /Grok \(ACP\)/i,
  'acp-antigravity': /Antigravity/i,
  dsh: /DeepSeek/i,
} satisfies Record<NodeHarnessId, RegExp>

describe('first-party harness settings entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.appState.settingsProvider = 'claude'
    hoisted.appState.harnessConfigSection = null
    hoisted.appState.harnessListFocusKey = null
    hoisted.enableHarness.mockResolvedValue({ ok: true })
    hoisted.refreshHarnessCatalog.mockResolvedValue(undefined)

    Object.defineProperty(window, 'app', {
      configurable: true,
      value: {
        getAppSettings: vi.fn().mockResolvedValue({
          enabledExperimentalAgents: [],
          experimentalAgentsEnabled: false,
          harnessOrder: [],
        }),
        onAppSettingsChange: vi.fn().mockReturnValue(() => {}),
        listHarnesses: vi.fn().mockResolvedValue(
          NODE_HARNESS_IDS.map((id) => ({
            id,
            enabled: false,
            state: 'disabled',
            runtimeSource:
              id === 'opencode' || id === 'acp-grok' ? 'external' : 'managed',
            requiresAuth: true,
          })),
        ),
        onHarnessInstallProgress: vi.fn().mockReturnValue(() => {}),
        enableHarness: hoisted.enableHarness,
        disableHarness: vi.fn(),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: originalApp,
    })
  })

  it.each(NODE_HARNESS_IDS)(
    'shows and enables the %s catalog harness',
    async (harnessId) => {
      const user = userEvent.setup()
      render(<HarnessesSettingsPage />)

      const harnessButton = await screen.findByRole('button', {
        name: HARNESS_LABELS[harnessId],
      })
      await user.click(harnessButton)
      await user.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(hoisted.enableHarness).toHaveBeenCalledWith({ harnessId })
      })
    },
  )

  it('opens the dsh MCP configuration tab', async () => {
    const user = userEvent.setup()
    render(<HarnessesSettingsPage />)

    await user.click(await screen.findByRole('button', { name: HARNESS_LABELS.dsh }))

    expect(screen.getByRole('tab', { name: /MCP/i })).toBeInTheDocument()
  })

  it('opens Codex on preferences without an account tab', async () => {
    const user = userEvent.setup()
    render(<HarnessesSettingsPage />)

    await user.click(await screen.findByRole('button', { name: HARNESS_LABELS.codex }))

    expect(screen.queryByRole('tab', { name: /Account|账号/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Preferences/i })).toHaveAttribute('data-state', 'active')
  })

  it.each(['opencode', 'acp-grok', 'acp-antigravity'] as const)(
    'keeps %s selected instead of snapping back to Claude Code',
    async (harnessId) => {
      const user = userEvent.setup()
      const view = render(<HarnessesSettingsPage />)

      await user.click(await screen.findByRole('button', { name: HARNESS_LABELS[harnessId] }))

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: /Subagents/i })).not.toBeInTheDocument()
      })
      expect(screen.getByRole('tab', { name: /Preferences/i })).toBeInTheDocument()
      expect(screen.getAllByRole('tab')).toHaveLength(harnessId === 'opencode' ? 1 : 2)
      if (harnessId === 'acp-grok' || harnessId === 'acp-antigravity') {
        expect(
          screen.getByText(harnessId === 'acp-antigravity' ? 'antigravity-account' : 'grok-account'),
        ).toBeInTheDocument()
        await user.click(screen.getByRole('tab', { name: /Preferences/i }))
        view.rerender(<HarnessesSettingsPage />)
      }
      expect(
        screen.getByText(
          harnessId === 'opencode' ? 'preferences-for-opencode' : 'preferences-for-acp',
        ),
      ).toBeInTheDocument()
    },
  )

  it('refreshes ACP agent detection and models in chat store right after enabling acp-antigravity', async () => {
    const listedResources = {
      agents: [{ id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy --acp' }],
      selectedAgentId: null,
      modelsByAgentId: {},
      configByAgentId: {},
    }
    const refreshedResources = {
      ...listedResources,
      modelsByAgentId: {
        antigravity: {
          models: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '' }],
          selectedModelId: 'gemini-2.5-pro',
          configId: 'model',
          updatedAt: '2026-11-04T00:00:00.000Z',
        },
      },
    }
    const listAcpAgents = vi.fn().mockResolvedValue(listedResources)
    const refreshAcpModels = vi.fn().mockResolvedValue(refreshedResources)
    Object.assign(window.app, { listAcpAgents, refreshAcpModels })

    const user = userEvent.setup()
    render(<HarnessesSettingsPage />)

    await user.click(await screen.findByRole('button', { name: HARNESS_LABELS['acp-antigravity'] }))
    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(hoisted.enableHarness).toHaveBeenCalledWith({ harnessId: 'acp-antigravity' })
      expect(listAcpAgents).toHaveBeenCalled()
      expect(refreshAcpModels).toHaveBeenCalledWith('antigravity')
      expect(chatMock.setHarnessResources).toHaveBeenCalledWith('acp', listedResources)
      expect(chatMock.setHarnessResources).toHaveBeenCalledWith('acp', refreshedResources)
    })
  })
})
