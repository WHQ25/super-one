import { useEffect, useState } from 'react'
import { LruMap } from '@superone/shared/lru-map'
import type { LinkPreview } from '@superone/shared/web-links'

export type LinkPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: LinkPreview }
  | { status: 'empty' }

/**
 * Summaries by link for this window, with the card image already fetched as a
 * data URL, so the card expands once with everything in place. A miss is kept
 * too: re-hovering a page without Open Graph tags must not refetch it.
 */
const loaded = new LruMap<string, Promise<LinkPreview | null>>(200)

async function load(href: string): Promise<LinkPreview | null> {
  const preview = await window.app.resolveLinkPreview(href)
  if (!preview?.image) return preview
  const image = await window.app.cacheRemoteImage(preview.image).catch(() => null)
  return { ...preview, image }
}

export function loadLinkPreview(href: string): Promise<LinkPreview | null> {
  const cached = loaded.get(href)
  if (cached) return cached
  const pending = load(href).catch(() => null)
  loaded.set(href, pending)
  return pending
}

/** The link's summary once `enabled` (its card is open); loading until then. */
export function useLinkPreview(href: string, enabled: boolean): LinkPreviewState {
  const [state, setState] = useState<{ href: string; value: LinkPreviewState }>({ href, value: { status: 'loading' } })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadLinkPreview(href).then((preview) => {
      if (!cancelled) setState({ href, value: preview ? { status: 'ready', preview } : { status: 'empty' } })
    })
    return () => { cancelled = true }
  }, [href, enabled])
  return state.href === href ? state.value : { status: 'loading' }
}
