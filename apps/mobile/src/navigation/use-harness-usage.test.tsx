import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { RemoteUsage } from '@superone/shared/agent-types'
import type { UsageTarget } from '../harness-usage'
import { useComposerUsage, useHarnessUsage } from './use-harness-usage'

const claude: UsageTarget = { projectPath: '/p', provider: 'claude', sessionId: 's1', apiProviderId: null, acpAgentId: null }

function meter(fetchedAt: number | null, label = '5h'): RemoteUsage {
  return { kind: 'claude', title: 'Claude', account: null, planType: null, extraUsage: null, fetchedAt,
    windows: [{ label, usedPercent: 10, resetsAt: null }] }
}

function renderUsage(client: RelayClient, initial: { target: UsageTarget | null; streaming: boolean }) {
  return renderHook(
    (props: { target: UsageTarget | null; streaming: boolean }) => {
      const clientRef = useRef(client)
      clientRef.current = client
      return useHarnessUsage({ clientRef, target: props.target, streaming: props.streaming })
    },
    { initialProps: initial },
  )
}

test('reads the meter for the credential on mount and again when a turn starts and ends', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now()) }))
  const client = { request } as unknown as RelayClient
  const { result, rerender } = await renderUsage(client, { target: claude, streaming: false })

  await waitFor(() => expect(result.current.usage?.windows[0]?.label).toBe('5h'))
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'get_usage', provider: 'claude', force: false }))

  await rerender({ target: claude, streaming: true })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await rerender({ target: claude, streaming: false })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
})

test('switching sessions on the same credential keeps the reading; a new credential clears it', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now()) }))
  const client = { request } as unknown as RelayClient
  const { result, rerender } = await renderUsage(client, { target: claude, streaming: false })
  await waitFor(() => expect(result.current.usage).not.toBeNull())

  await rerender({ target: { ...claude, sessionId: 's2' }, streaming: false })
  expect(result.current.usage).not.toBeNull()
  expect(request).toHaveBeenCalledTimes(1)

  let release: (value: { usage: RemoteUsage }) => void = () => {}
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  await rerender({ target: { ...claude, provider: 'codex' }, streaming: false })
  expect(result.current.usage).toBeNull()
  await act(async () => { release({ usage: meter(Date.now(), '7d') }) })
  await waitFor(() => expect(result.current.usage?.windows[0]?.label).toBe('7d'))
})

test('refresh forces a host read only when the reading on screen is stale', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now()) }))
  const client = { request } as unknown as RelayClient
  const { result } = await renderUsage(client, { target: claude, streaming: false })
  await waitFor(() => expect(result.current.usage).not.toBeNull())

  // The reading on screen is fresh, so an opened panel does not hit the host again.
  await act(async () => { await result.current.refresh() })
  expect(request).toHaveBeenCalledTimes(1)
})

test('a stale reading makes refresh ask the host with force', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now() - 6 * 60_000) }))
  const client = { request } as unknown as RelayClient
  const { result } = await renderUsage(client, { target: claude, streaming: false })
  await waitFor(() => expect(result.current.usage).not.toBeNull())

  await act(async () => { await result.current.refresh() })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }))
  expect(result.current.refreshing).toBe(false)
})

test('no target means no request', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now()) }))
  const client = { request } as unknown as RelayClient
  await renderUsage(client, { target: null, streaming: false })
  expect(request).not.toHaveBeenCalled()
})

test('returning to a credential shows its last reading at once while the host confirms it', async () => {
  const request = jest.fn(async (command: { provider: string }) => ({
    usage: meter(Date.now(), command.provider === 'codex' ? '7d' : '5h'),
  }))
  const client = { request } as unknown as RelayClient
  const { result, rerender } = await renderUsage(client, { target: claude, streaming: false })
  await waitFor(() => expect(result.current.usage?.windows[0]?.label).toBe('5h'))

  await rerender({ target: { ...claude, provider: 'codex' }, streaming: false })
  await waitFor(() => expect(result.current.usage?.windows[0]?.label).toBe('7d'))

  let release: (value: { usage: RemoteUsage }) => void = () => {}
  request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  await rerender({ target: claude, streaming: false })
  // The cached Claude reading is on screen before the host answers, and the host is still asked.
  expect(result.current.usage?.windows[0]?.label).toBe('5h')
  expect(request).toHaveBeenCalledTimes(3)
  await act(async () => { release({ usage: meter(Date.now(), '5h') }) })
})

test('the composer meter keeps its credential while an opened session waits for its catalog', async () => {
  const request = jest.fn(async () => ({ usage: meter(Date.now()) }))
  const client = { request } as unknown as RelayClient
  type Props = { sessionId: string; apiProviderId: string | null; catalogReady: boolean }
  const { result, rerender } = await renderHook(
    (props: Props) => {
      const clientRef = useRef(client)
      return useComposerUsage({
        clientRef, projectPath: '/p', provider: 'claude', acpAgentId: null, streaming: false, rateLimit: null, ...props,
      })
    },
    { initialProps: { sessionId: 's1', apiProviderId: 'cred-a', catalogReady: true } },
  )
  await waitFor(() => expect(result.current.usage).not.toBeNull())
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ apiProviderId: 'cred-a' }))

  // Opening s2 blanks the selection until its catalog answers: not a change of credential.
  await rerender({ sessionId: 's2', apiProviderId: null, catalogReady: false })
  expect(result.current.usage).not.toBeNull()
  expect(request).toHaveBeenCalledTimes(1)

  await rerender({ sessionId: 's2', apiProviderId: 'cred-a', catalogReady: true })
  expect(result.current.usage).not.toBeNull()
  expect(request).toHaveBeenCalledTimes(1)

  // The catalog naming another credential is a real switch.
  await rerender({ sessionId: 's2', apiProviderId: 'cred-b', catalogReady: true })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ apiProviderId: 'cred-b' }))
})
