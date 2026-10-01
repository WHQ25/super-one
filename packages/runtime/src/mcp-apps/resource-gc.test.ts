import { afterEach, expect, it, vi } from 'vitest'
import type { McpAppResourceStore } from '@superone/shared/mcp-app-resource'
import { createMcpAppResourceGc } from './resource-gc'

afterEach(() => vi.useRealTimers())

it('coalesces deletion sweeps, reads current references after grace, and cancels on disposal', () => {
  vi.useFakeTimers()
  const collect = vi.fn(() => 0)
  const store = { collect } as unknown as McpAppResourceStore
  let references = ['shared', 'deleted']
  const gc = createMcpAppResourceGc(store, () => references, 100)
  gc.schedule(); gc.schedule()
  vi.advanceTimersByTime(0)
  expect(collect).toHaveBeenCalledExactlyOnceWith(references, 100)
  references = ['shared']
  vi.advanceTimersByTime(101)
  expect(collect).toHaveBeenLastCalledWith(['shared'], 100)
  expect(collect).toHaveBeenCalledTimes(2)
  gc.schedule(); gc.dispose()
  vi.runAllTimers()
  expect(collect).toHaveBeenCalledTimes(2)
})

it('never collects if the authoritative persisted reference scan fails', () => {
  vi.useFakeTimers()
  const collect = vi.fn(() => 0)
  const gc = createMcpAppResourceGc({ collect } as unknown as McpAppResourceStore, () => { throw new Error('database unavailable') }, 100)
  gc.schedule(); vi.runAllTimers(); gc.dispose()
  expect(collect).not.toHaveBeenCalled()
})
