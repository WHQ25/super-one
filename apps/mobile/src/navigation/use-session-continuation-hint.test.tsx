import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, render } from '@testing-library/react-native'
import type { SessionCacheExpiry } from '@superone/shared/session-continuation'
import { MOBILE_SESSION_CONTINUATION_HINT_KEY } from '../mobile-preferences'
import { useSessionContinuationHint } from './use-session-continuation-hint'

const NOW = Date.parse('2026-10-16T10:00:00.000Z')
const values = new Map<string, string>()
const store = {
  get: async (key: string) => values.get(key) ?? null,
  set: async (key: string, value: string) => { values.set(key, value) },
}

let hint: ReturnType<typeof useSessionContinuationHint>
function Probe(props: { sessionId: string | null; expiry: SessionCacheExpiry | null; idle?: boolean }) {
  hint = useSessionContinuationHint({ store, idle: true, ...props })
  return null
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  values.clear()
})
afterEach(() => { jest.useRealTimers() })

test('shows once the long session\'s cache expires, holds a dismissal, and is off for good after Don\'t Show Again', async () => {
  const expiry = { expiresAt: NOW + 60_000, contextTokens: 400_000 }
  const view = await render(<Probe sessionId="s1" expiry={expiry} />)
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

  await act(async () => { hint.dontShowAgain() })
  expect(hint.visible).toBe(false)
  expect(JSON.parse(values.get(MOBILE_SESSION_CONTINUATION_HINT_KEY)!)).toEqual({ enabled: false, minContextTokens: 300_000 })
})
