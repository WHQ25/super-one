/** @vitest-environment jsdom */

/**
 * Regression: upgrading to a build whose pinned Claude harness binary has not
 * landed in ~/.superone/harness yet made `connectClaude` reject forever. The
 * "fill empty catalog" effect re-fired on every `claudeResourcesLoading`
 * toggle, storming main with ~10k IPC calls per second until React bailed with
 * error #185 (Maximum update depth exceeded) and blanked the window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('@/stores/settings', () => {
  const state = {
    platforms: [],
    credentials: [],
    bindings: [],
    providerScope: 'global',
    fetchProviderData: vi.fn().mockResolvedValue(undefined),
  }
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

vi.mock('./useSelectorProviders', () => ({
  useSelectorProviders: () => ({}),
}))

vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: () => <div data-testid="model-selector" />,
}))

import { ClaudeModelSelector } from './ClaudeModelSelector'
import { useChatStore } from '@/stores/chat'

const connectClaude = vi.fn()

beforeEach(() => {
  connectClaude.mockReset()
  connectClaude.mockRejectedValue(
    new Error(
      "Error invoking remote method 'app:connect-claude': Error: Native CLI binary for darwin-arm64 not found.",
    ),
  )
  ;(window as unknown as { app: Record<string, unknown> }).app = { connectClaude }

  useChatStore.setState({
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
    initializedHarnesses: new Set(),
    claudeResourcesLoading: false,
  })
  useChatStore.getState().ensureSession('/白屏')
  useChatStore.setState({ activeProject: '/白屏' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Let every queued microtask + timer settle, repeatedly — a storm needs turns to build. */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const EMPTY_RESOURCES = {
  models: [],
  account: {},
  slashCommands: [],
  skills: [],
  commands: [],
  agents: [],
  outputStyles: [],
}

describe('ClaudeModelSelector with a missing Claude harness binary', () => {
  it('stops probing instead of re-firing on every loading toggle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<ClaudeModelSelector />)
    await settle()

    // Bootstrap may legitimately try connect twice (initializeHarness, then one
    // forced refresh). Anything beyond that is the runaway retry loop.
    expect(connectClaude.mock.calls.length).toBeLessThanOrEqual(2)

    warn.mockRestore()
  })

  // Main now answers "harness not installed" with an empty catalog instead of a
  // rejection (users who never enabled Claude are the common case). An empty
  // catalog must not read as "keep asking" either.
  it('stops probing when main reports an empty catalog', async () => {
    connectClaude.mockReset()
    connectClaude.mockResolvedValue(EMPTY_RESOURCES)

    render(<ClaudeModelSelector />)
    await settle()

    expect(connectClaude.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
