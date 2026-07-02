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

describe('BrowserFavicon candidate ordering', () => {
  it('keeps the live capture on top of the cache for a browser tab (preferSrc)', async () => {
    const resolveFavicon = mockResolveFavicon(async () => 'data:cache')
    const { container } = render(
      <BrowserFavicon preferSrc src="https://site.com/live.png" url="https://site.com/" fallback={FALLBACK} />,
    )
    // The captured favicon is ground truth and must survive the cache resolving.
    await waitFor(() => expect(resolveFavicon).toHaveBeenCalled())
    expect(imgSrc(container)).toBe('https://site.com/live.png')
  })

  it('upgrades a bookmark from its stored icon to the fresher cache entry', async () => {
    mockResolveFavicon(async () => 'data:cache')
    const { container } = render(
      <BrowserFavicon src="https://site.com/stored.png" url="https://site.com/" fallback={FALLBACK} />,
    )
    // Instant paint from the stored icon, then the shared cache wins.
    expect(imgSrc(container)).toBe('https://site.com/stored.png')
    await waitFor(() => expect(imgSrc(container)).toBe('data:cache'))
  })

  it('derives /favicon.ico when neither a capture nor a cache entry exists', async () => {
    const resolveFavicon = mockResolveFavicon(async () => null)
    const { container } = render(<BrowserFavicon url="https://site.com/page" fallback={FALLBACK} />)
    await waitFor(() => expect(resolveFavicon).toHaveBeenCalled())
    expect(imgSrc(container)).toBe('https://site.com/favicon.ico')
  })

  it('renders the fallback for a non-http url with nothing to show', () => {
    mockResolveFavicon(async () => null)
    const { getByTestId, container } = render(<BrowserFavicon url="about:blank" fallback={FALLBACK} />)
    expect(getByTestId('fallback')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('falls through to the next candidate when an image fails to load', async () => {
    mockResolveFavicon(async () => null)
    const { container } = render(
      <BrowserFavicon preferSrc src="https://site.com/bad.png" url="https://site.com/page" fallback={FALLBACK} />,
    )
    expect(imgSrc(container)).toBe('https://site.com/bad.png')
    fireEvent.error(container.querySelector('img')!)
    await waitFor(() => expect(imgSrc(container)).toBe('https://site.com/favicon.ico'))
  })
})
