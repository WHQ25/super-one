/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEnvironmentItems, resetEnvironmentListCache, subscribeEnvironmentList } from './environment-list'

const listItems = vi.fn()
let status: ((snapshot: { connectionId: string }) => void) | null = null

beforeEach(() => {
  resetEnvironmentListCache()
  listItems.mockReset()
  status = null
  listItems.mockResolvedValue([{ connectionId: 'env-1', label: 'b' }])
  ;(window as unknown as { environment: unknown }).environment = {
    listItems,
    onStatusEvent: (listener: (snapshot: { connectionId: string }) => void) => {
      status = listener
      return () => { if (status === listener) status = null }
    },
  }
})

describe('loadEnvironmentItems', () => {
  it('shares one IPC until a status push drops the cache', async () => {
    const [first, second] = await Promise.all([loadEnvironmentItems(), loadEnvironmentItems()])
    expect(first).toEqual(second)
    expect(listItems).toHaveBeenCalledTimes(1)
    await loadEnvironmentItems()
    expect(listItems).toHaveBeenCalledTimes(1)

    const seen: number[] = []
    const unsubscribe = subscribeEnvironmentList(() => { seen.push(listItems.mock.calls.length) })
    status?.({ connectionId: 'env-1' })
    expect(seen).toEqual([1])
    await loadEnvironmentItems()
    expect(listItems).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('binds the status bridge of the environment object installed for this test', async () => {
    const unsubscribe = subscribeEnvironmentList(() => {})
    expect(status).toBeTypeOf('function')
    unsubscribe()
    expect(status).toBeNull()
  })
})
