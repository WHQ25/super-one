import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { FAVICON_SETTLE_MS, useLinkFavicons } from './use-link-favicons'
import { resetLinkFaviconCacheForTests } from '../link-favicons'
import { WEB_LINK_GLOBE } from '../composer-web-links'

const PNG = 'data:image/png;base64,iVBORw=='

beforeEach(() => { resetLinkFaviconCacheForTests(); jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

it('asks for a favicon once the draft rests, then draws it instead of the globe', async () => {
  const resolve = jest.fn(async (_href: string, _isDark: boolean): Promise<string | null> => PNG)
  const hook = await renderHook(({ text }: { text: string }) => useLinkFavicons(text, 'light', '#000000', resolve), { initialProps: { text: 'https://e' } })
  expect(hook.result.current.iconFor('https://e')).toBe(WEB_LINK_GLOBE)
  expect(hook.result.current.artwork.map((row) => row.key)).toEqual([WEB_LINK_GLOBE])
  // Typing the host: every keystroke is a new origin, none of them asked about.
  await act(async () => { jest.advanceTimersByTime(FAVICON_SETTLE_MS / 2) })
  await hook.rerender({ text: 'https://example.com/docs' })
  await act(async () => { jest.advanceTimersByTime(FAVICON_SETTLE_MS - 1) })
  expect(resolve).not.toHaveBeenCalled()
  await act(async () => { jest.advanceTimersByTime(1) })
  expect(resolve).toHaveBeenCalledTimes(1)
  expect(resolve).toHaveBeenCalledWith('https://example.com/docs', false)
  expect(hook.result.current.iconFor('https://example.com')).toBe('favicon:https://example.com')
  expect(hook.result.current.artwork).toContainEqual({ key: 'favicon:https://example.com', png: 'iVBORw==' })
  // More text on the same site is answered from the cache.
  await hook.rerender({ text: 'https://example.com/docs and https://example.com/blog' })
  await act(async () => { jest.advanceTimersByTime(FAVICON_SETTLE_MS) })
  expect(resolve).toHaveBeenCalledTimes(1)
})

it('keeps the globe for an SVG favicon and without a resolver', async () => {
  const svg = jest.fn(async (_url: string, _monochrome: boolean): Promise<string | null> => 'data:image/svg+xml;base64,PHN2Zz4=')
  const hook = await renderHook(() => useLinkFavicons('https://svg.dev', 'dark', '#ffffff', svg))
  await act(async () => { jest.advanceTimersByTime(FAVICON_SETTLE_MS) })
  expect(svg).toHaveBeenCalledWith('https://svg.dev', true)
  expect(hook.result.current.iconFor('https://svg.dev')).toBe(WEB_LINK_GLOBE)
  const none = await renderHook(() => useLinkFavicons('plain text', 'dark', '#ffffff'))
  expect(none.result.current.artwork).toEqual([])
})
