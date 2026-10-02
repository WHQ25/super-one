/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpenCodeResources } from '@superone/shared/agent-types'
const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success, error } }))
vi.mock('./GroupedModelEffortSelector', () => ({
  GroupedModelEffortSelector: (props: { onRefreshModels: () => void; modelsLoading: boolean }) => (
    <button disabled={props.modelsLoading} onClick={props.onRefreshModels}>Refresh models</button>
  ),
}))
import { OpenCodeModelSelector } from './OpenCodeModelSelector'
import { useChatStore } from '@/stores/chat'
const initial: OpenCodeResources = { models: [{ id: 'openai/old', name: 'Old', description: 'Model catalog fixture' }], agents: [], commands: [] }
const fresh: OpenCodeResources = { models: [{ id: 'opencode/new', name: 'New', description: 'Model catalog fixture' }], agents: [], commands: [] }
const connect = vi.fn<(force?: boolean) => Promise<OpenCodeResources>>()
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window.app, { connectOpenCode: connect })
  useChatStore.setState({ projectSessions: {}, activeProject: null, harnessResources: {
    claude: null, codex: null, acp: null, opencode: initial, cursor: null, dsh: null,
  } })
})
afterEach(cleanup)
describe('OpenCode manual model refresh', () => {
  it('forces a probe, prevents repeated clicks, and applies the returned catalog', async () => {
    let resolve!: (value: OpenCodeResources) => void
    connect.mockImplementation(() => new Promise((done) => { resolve = done }))
    render(<OpenCodeModelSelector />)
    const button = screen.getByRole('button', { name: 'Refresh models' })
    fireEvent.click(button)
    expect(connect).toHaveBeenCalledWith(true)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(connect).toHaveBeenCalledTimes(1)
    await act(async () => resolve(fresh))
    expect(useChatStore.getState().harnessResources.opencode).toEqual(fresh)
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(success).toHaveBeenCalledOnce()
  })
  it('preserves the previous catalog on failure and permits retry', async () => {
    connect.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fresh)
    render(<OpenCodeModelSelector />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(error).toHaveBeenCalledOnce())
    expect(useChatStore.getState().harnessResources.opencode).toEqual(initial)
    expect(success).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(success).toHaveBeenCalledOnce())
  })
  it('offers refresh with an empty catalog', async () => {
    useChatStore.getState().setHarnessResources('opencode', { models: [], agents: [], commands: [] })
    connect.mockResolvedValue(fresh)
    render(<OpenCodeModelSelector />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(useChatStore.getState().harnessResources.opencode).toEqual(fresh))
  })
})
