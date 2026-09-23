import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useState } from 'react'
import { permissionRequest } from '../preview/permissions'
import type { MobileRoute } from './route-state'
import { collabRequestOf, useCollabRequest } from './use-collab-request'

const request = collabRequestOf(permissionRequest('session_agents_confirm'))!

/** The shell's `screen` state beside the hook, so the route it drives is observable. */
async function mount(initial: MobileRoute = 'chat') {
  const reject = jest.fn()
  const hook = await renderHook(({ pending }: { pending: boolean }) => {
    const [screen, setScreen] = useState<MobileRoute>(initial)
    const collab = useCollabRequest({ request: pending ? request : null, screen, setScreen, reject })
    return { screen, setScreen, collab }
  }, { initialProps: { pending: true } })
  return { ...hook, reject }
}

test('only a session_agents_confirm becomes a page; the sheet keeps the rest', () => {
  expect(collabRequestOf(permissionRequest('config_confirm'))).toBeNull()
  expect(request.payload.launches).toHaveLength(3)
})

test('a pending request opens its page, and answering it returns to chat', async () => {
  const { result, rerender, reject } = await mount()
  expect(result.current.screen).toBe('collab-request')

  await act(async () => { result.current.collab.answered(request.requestId) })
  expect(result.current.screen).toBe('chat')
  // The host has not cleared the request yet: the page must not reopen meanwhile.
  await act(async () => { rerender({ pending: true }) })
  expect(result.current.screen).toBe('chat')
  expect(reject).not.toHaveBeenCalled()
})

test('walking away from the page rejects the request', async () => {
  const { result, reject } = await mount()
  await act(async () => { result.current.collab.leave() })
  expect(reject).toHaveBeenCalledWith(request.requestId)
  expect(result.current.screen).toBe('chat')
  expect(result.current.collab.open).toBeNull()
})

test('the page closes on its own once the host drops the request', async () => {
  const { result, rerender } = await mount()
  await act(async () => { rerender({ pending: false }) })
  expect(result.current.screen).toBe('chat')
})
