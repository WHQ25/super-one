/** @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { BrowserFavicon } from './BrowserFavicon'

function mockResolveFavicon(fn: (url: string, isDark: boolean) => Promise<string | null>) {
  const resolveFavicon = vi.fn(fn)
  ;(window as unknown as { app: { resolveFavicon: typeof resolveFavicon } }).app = { resolveFavicon }
  return resolveFavicon
}

const FALLBACK = <span data-testid="fallback" />
const imgSrc = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src')

afterEach(cleanup)

describe('BrowserFavicon renders only cached data URLs', () => {
  it('shows the cached data URL and never the remote favicon URL (preferSrc)', async () => {
    // Regression: a hotlink-protected CDN favicon URL (e.g. bilibili i0.hdslb.com) must
    // never reach `<img src>` — a cold renderer fetch of it paints a broken image.
    const resolveFavicon = mockResolveFavicon(async () => 'data:cache')
    const { container } = render(
      <BrowserFavicon preferSrc src="https://i0.hdslb.com/favicon.ico" url="https://www.bilibili.com/" fallback={FALLBACK} />,
    )
    await waitFor(() => expect(resolveFavicon).toHaveBeenCalled())
    await waitFor(() => expect(imgSrc(container)).toBe('data:cache'))
    expect(imgSrc(container)).not.toContain('http')
  })

  it('lets a data-URL src (a live capture) win over the origin cache with preferSrc', async () => {
    mockResolveFavicon(async () => 'data:cache')
    const { container } = render(
      <BrowserFavicon preferSrc src="data:live" url="https://site.com/" fallback={FALLBACK} />,
    )
    // A resolved data-URL capture is ground truth and must survive the cache resolving.
    await waitFor(() => expect(imgSrc(container)).toBe('data:live'))
  })

  it('ignores a remote stored icon and shows the cache for a bookmark', async () => {
    mockResolveFavicon(async () => 'data:cache')
    const { container } = render(
      <BrowserFavicon src="https://site.com/stored.png" url="https://site.com/" fallback={FALLBACK} />,
    )
    await waitFor(() => expect(imgSrc(container)).toBe('data:cache'))
  })

  it('falls back to the globe when the cache misses and there is no data-URL src', async () => {
    const resolveFavicon = mockResolveFavicon(async () => null)
    const { getByTestId, container } = render(
      <BrowserFavicon preferSrc src="https://site.com/bad.png" url="https://site.com/page" fallback={FALLBACK} />,
    )
    await waitFor(() => expect(resolveFavicon).toHaveBeenCalled())
    expect(getByTestId('fallback')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the fallback for a non-http url with nothing to show', () => {
    mockResolveFavicon(async () => null)
    const { getByTestId, container } = render(<BrowserFavicon url="about:blank" fallback={FALLBACK} />)
    expect(getByTestId('fallback')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('falls back to the globe when a cached data URL fails to load', async () => {
    mockResolveFavicon(async () => 'data:broken')
    const { getByTestId, container } = render(<BrowserFavicon url="https://site.com/page" fallback={FALLBACK} />)
    await waitFor(() => expect(imgSrc(container)).toBe('data:broken'))
    fireEvent.error(container.querySelector('img')!)
    await waitFor(() => expect(getByTestId('fallback')).toBeInTheDocument())
  })
})
