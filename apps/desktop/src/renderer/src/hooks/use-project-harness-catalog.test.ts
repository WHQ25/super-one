/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectHarnessCatalog } from './use-project-harness-catalog'
import { isCatalogHarnessEnabled } from '@/lib/harness-visibility'
import { useChatStore } from '@/stores/chat'

const listItems = vi.fn()
let statusListener: ((snapshot: { connectionId: string; state: string }) => void) | null = null
const LOCAL = [{ id: 'claude', enabled: true, state: 'ready' }]
const node = (harnessIds: string[]) => [{ connectionId: 'node-1', capabilities: { harnessIds } }]

beforeEach(() => {
  listItems.mockReset()
  statusListener = null
  ;(window as unknown as { environment: unknown }).environment = {
    listItems,
    onStatusEvent: (listener: typeof statusListener) => {
      statusListener = listener
      return () => { statusListener = null }
    },
  }
})

describe('useProjectHarnessCatalog', () => {
  it("keeps this desktop's catalog for its own projects", () => {
    useChatStore.setState({ activeProject: '/repo' })
    const { result } = renderHook(() => useProjectHarnessCatalog(LOCAL))
    expect(result.current).toBe(LOCAL)
    expect(listItems).not.toHaveBeenCalled()
  })

  it("offers a node's harnesses, not this desktop's, and follows them when it reconnects", async () => {
    useChatStore.setState({ activeProject: 'remote:node-1:/repo' })
    listItems.mockResolvedValue(node(['codex']))
    const { result } = renderHook(() => useProjectHarnessCatalog(LOCAL))
    expect(result.current).toBeNull()
    await waitFor(() => expect(isCatalogHarnessEnabled(result.current, 'codex')).toBe(true))
    expect(isCatalogHarnessEnabled(result.current, 'claude')).toBe(false)

    listItems.mockResolvedValue(node(['codex', 'claude']))
    act(() => statusListener?.({ connectionId: 'node-1', state: 'connected' }))
    await waitFor(() => expect(isCatalogHarnessEnabled(result.current, 'claude')).toBe(true))
  })
})
