/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'

const hoisted = vi.hoisted(() => ({
  enableHarness: vi.fn(),
  refreshHarnessCatalog: vi.fn(),
}))

const originalApp = window.app

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      harnessResources: { acp: { agents: [] } },
      initializeHarness: vi.fn(),
    }),
}))

vi.mock('@/stores/app', () => {
  const state = {
    settingsProvider: 'claude',
    setSettingsProvider: vi.fn(),
    harnessConfigSection: null,
    setHarnessConfigSection: vi.fn(),
    harnessListFocusKey: null,
    refreshHarnessCatalog: hoisted.refreshHarnessCatalog,
  }
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      setState: vi.fn(),
    },
  )
  return { useAppStore }
})

vi.mock('./AgentsPage', () => ({ AgentsPage: () => null }))
vi.mock('./SkillsPage', () => ({ SkillsPage: () => null }))
vi.mock('./McpPage', () => ({ McpPage: () => null }))
vi.mock('./HooksPage', () => ({ HooksPage: () => null }))
vi.mock('./PluginsPage', () => ({ PluginsPage: () => null }))
vi.mock('./PreferencesPage', () => ({ PreferencesPage: () => null }))
vi.mock('./CursorAuthSettings', () => ({ CursorAuthSettings: () => null }))
vi.mock('./CodexAuthSettings', () => ({ CodexAuthSettings: () => <div>Codex account settings</div> }))

const HARNESS_LABELS = {
  claude: /Claude Code/i,
  codex: /^Codex/i,
  opencode: /OpenCode/i,
  cursor: /^Cursor/i,
  'acp-grok': /Grok \(ACP\)/i,
  dsh: /DeepSeek/i,
} satisfies Record<NodeHarnessId, RegExp>

describe('first-party harness settings entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('opens Codex on the account tab', async () => {
    const user = userEvent.setup()
    render(<HarnessesSettingsPage />)

    await user.click(await screen.findByRole('button', { name: HARNESS_LABELS.codex }))

    expect(screen.getByRole('tab', { name: /Account|账号/i })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Codex account settings')).toBeInTheDocument()
  })
})
