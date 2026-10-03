import { afterEach, expect, it, vi } from 'vitest'
import { CodexUserInputBudget } from './user-input-budget'

afterEach(() => vi.useRealTimers())

it('pauses overlapping waits once and keeps remaining deadlines after the last answer', async () => {
  vi.useFakeTimers()
  const budget = new CodexUserInputBudget()
  const first = vi.fn(), second = vi.fn()
  budget.deadline(100, first)
  await vi.advanceTimersByTimeAsync(40)
  budget.begin('one')
  await vi.advanceTimersByTimeAsync(500)
  budget.begin('two')
  budget.deadline(200, second)
  budget.end('one')
  await vi.advanceTimersByTimeAsync(500)
  expect(budget.getWaitMs()).toBe(1000)
  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
  budget.end('two')
  await vi.advanceTimersByTimeAsync(59)
  expect(first).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(first).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(140)
  expect(second).toHaveBeenCalledOnce()
  expect(budget.getWaitMs()).toBe(1000)
})

it('removes a cancelled deadline even while input is pending', async () => {
  vi.useFakeTimers()
  const budget = new CodexUserInputBudget(), expire = vi.fn()
  budget.begin(0)
  budget.deadline(100, expire)()
  budget.end(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(expire).not.toHaveBeenCalled()
})
