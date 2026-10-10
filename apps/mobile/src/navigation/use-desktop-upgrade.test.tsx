import { expect, it, jest } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useDesktopUpgrade } from './use-desktop-upgrade'

const old = Object.assign(new Error('Upgrade required'), { code: 'desktop_upgrade_required' as const, minimumVersion: '0.73.0-alpha.1' as const,
  host: { appVersion: '0.72.2', protocol: 2, environmentId: 'desk' } })
it('retains the problem when a retry fails and ignores a receipt from a dismissed retry', async () => {
  let reject!: (error: Error) => void
  const reconnect = jest.fn(() => new Promise<void>((_resolve, no) => { reject = no }))
  const dismiss = jest.fn(async () => {})
  const hook = await renderHook(() => useDesktopUpgrade({ reconnect, dismiss }))
  await act(() => hook.result.current.show(old, 'Desk', 'desk'))
  let retry!: Promise<void>
  await act(() => { retry = hook.result.current.reconnect(); void hook.result.current.reconnect() })
  expect(reconnect).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('Unavailable')); await retry })
  expect(hook.result.current.problem?.pairingId).toBe('desk')
  expect(hook.result.current.error).toBe('Unavailable')
  await act(() => { retry = hook.result.current.reconnect() })
  await act(async () => { await hook.result.current.dismiss(); reject(new Error('Late error')); await retry })
  expect(hook.result.current.problem).toBeNull()
  expect(hook.result.current.error).toBeUndefined()
  expect(dismiss).toHaveBeenCalledTimes(1)
})
