/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { ProviderSelector } from './ChatSuggestions'

vi.mock('@/components/coding/ProjectSelector', () => ({ ProjectSelector: () => null }))
vi.mock('@/components/sidebar/add-project/AddProjectDialog', () => ({ AddProjectDialog: () => null }))

const NO_HARNESS = 'No harness enabled yet'

describe('ProviderSelector harness catalog', () => {
  beforeEach(() => {
    // The hint row resolves the effective provider on mount; without seeded provider
    // data its fetch runs against the mocked IPC and leaves the store undefined.
    useSettingsStore.setState({
      bindings: [], credentials: [], platforms: [], fetchProviderData: async () => {},
    })
    window.app.listHarnesses = vi.fn(async () => [
      { id: 'codex', enabled: true, state: 'installed', runtimeSource: 'bundled', requiresAuth: false },
    ])
  })

  it('keeps the harness row rendered when a new session id remounts the selector', async () => {
    const first = render(<ProviderSelector />)
    // An unloaded catalog is indistinguishable from an empty one, so the first ever
    // mount does show the empty state until `listHarnesses` answers.
    expect(screen.getByText(NO_HARNESS)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(NO_HARNESS)).not.toBeInTheDocument())
    first.unmount()

    // Switching harness on an empty session mints a new session id, which remounts
    // this component. Restarting from an unloaded catalog paints "No harness enabled
    // yet" for one IPC round trip — a flash in the middle of the chat.
    render(<ProviderSelector />)

    expect(screen.queryByText(NO_HARNESS)).not.toBeInTheDocument()
  })
})
