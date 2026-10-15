import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, render } from '@testing-library/react-native'
import type { SessionCacheExpiry } from '@superone/shared/session-continuation'
import { useSessionContinuationHint } from './use-session-continuation-hint'

const NOW = Date.parse('2026-10-16T10:00:00.000Z')
const rpc = jest.fn<(method: string, payload?: unknown) => Promise<unknown>>()
const clientRef = { current: { rpc } as never }

let hint: ReturnType<typeof useSessionContinuationHint>
function Probe(props: { sessionId: string | null; expiry: SessionCacheExpiry | null; idle?: boolean; connected?: boolean }) {
  hint = useSessionContinuationHint({ clientRef, connected: true, idle: true, ...props })
  return null
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  rpc.mockReset()
})
afterEach(() => { jest.useRealTimers() })

test('shows once the long session\'s cache expires and holds a dismissal until the next expiry', async () => {
  // A host that has no such setting: the default applies.
  rpc.mockResolvedValue({ settings: {} })
  const expiry = { expiresAt: NOW + 60_000, contextTokens: 400_000 }
  const view = await render(<Probe sessionId="s1" expiry={expiry} />)
  expect(rpc).toHaveBeenCalledWith('settings.get', {})
  expect(hint.visible).toBe(false)

  await act(async () => { jest.advanceTimersByTime(60_000) })
  expect(hint.visible).toBe(true)

  // Busy and short sessions never hint.
  await view.rerender(<Probe sessionId="s1" expiry={expiry} idle={false} />)
  expect(hint.visible).toBe(false)
  await view.rerender(<Probe sessionId="s1" expiry={{ ...expiry, contextTokens: 100_000 }} />)
  expect(hint.visible).toBe(false)

  await view.rerender(<Probe sessionId="s1" expiry={expiry} />)
  await act(async () => { hint.dismiss() })
  expect(hint.visible).toBe(false)

  // A later turn's expiry asks again.
  await view.rerender(<Probe sessionId="s1" expiry={{ ...expiry, expiresAt: NOW + 30_000 }} />)
  expect(hint.visible).toBe(true)
})

test('follows the desktop setting', async () => {
  const expiry = { expiresAt: NOW - 1, contextTokens: 400_000 }
  rpc.mockResolvedValue({ settings: { sessionContinuationHint: { enabled: false, minContextTokens: 300_000 } } })
  await render(<Probe sessionId="s1" expiry={expiry} />)
  await act(async () => {})
  expect(hint.visible).toBe(false)

  rpc.mockResolvedValue({ settings: { sessionContinuationHint: { enabled: true, minContextTokens: 500_000 } } })
  await render(<Probe sessionId="s2" expiry={expiry} />)
  await act(async () => {})
  expect(hint.visible).toBe(false)
})
