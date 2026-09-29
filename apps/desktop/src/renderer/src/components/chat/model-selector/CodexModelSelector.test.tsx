/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat'

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('./useSelectorProviders', () => ({ useSelectorProviders: () => ({}) }))
vi.mock('../CodexModeSelector', () => ({ CodexModeSelector: () => null }))
vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: ({ onRefreshModels }: { onRefreshModels: () => void }) => (
    <button onClick={onRefreshModels}>Refresh models</button>
  ),
}))

import { CodexModelSelector } from './CodexModelSelector'

describe('CodexModelSelector manual refresh', () => {
  const original = useChatStore.getState()

  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({ projectSessions: {}, activeProject: null })
    useChatStore.getState().ensureSession('/codex-selector')
    useChatStore.setState({ activeProject: '/codex-selector' })
  })

  afterEach(() => {
    cleanup()
    useChatStore.setState(original, true)
  })

  it('reports a successful forced refresh even when the model list is unchanged', async () => {
    const refresh = vi.fn().mockResolvedValue([{ id: 'gpt-test', name: 'GPT Test' }])
    useChatStore.setState({ refreshCodexModels: refresh })
    render(<CodexModelSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('1')))
    expect(refresh).toHaveBeenCalledWith(true)
  })

  it('reports a failed forced refresh', async () => {
    useChatStore.setState({ refreshCodexModels: vi.fn().mockResolvedValue(null) })
    render(<CodexModelSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })
})
