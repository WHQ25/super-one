import { expect, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { useQueuedSteerCapabilities } from './use-queued-steer-capabilities'

test('publishes V2 steering synchronously and clears it for a legacy runtime or another harness', async () => {
  const hook = await renderHook(({ harness }: { harness: HarnessId }) => useQueuedSteerCapabilities(harness), { initialProps: { harness: 'opencode' as HarnessId } })
  expect(hook.result.current.now).toBe(false)
  await act(() => {
    hook.result.current.sync({ harnessId: 'opencode', supportsQueuedSteer: true, supportsQueuedSteerSoon: false })
    expect(hook.result.current.ref.current).toEqual({ now: true, soon: false })
  })
  expect(hook.result.current.now).toBe(true)
  await hook.rerender({ harness: 'cursor' })
  expect(hook.result.current.ref.current).toEqual({ now: false, soon: false })
  await hook.rerender({ harness: 'opencode' })
  await act(() => hook.result.current.sync(undefined))
  expect(hook.result.current.now).toBe(false)
})

test('does not carry V2 steering into another OpenCode session before its native catalog arrives', async () => {
  const hook = await renderHook(({ scope }: { scope: string }) => useQueuedSteerCapabilities('opencode', undefined, scope), { initialProps: { scope: 'v2' } })
  await act(() => hook.result.current.sync({ harnessId: 'opencode', supportsQueuedSteer: true }))
  expect(hook.result.current.now).toBe(true)
  await hook.rerender({ scope: 'v1' })
  expect(hook.result.current.now).toBe(false)
  expect(hook.result.current.ref.current.now).toBe(false)
})
