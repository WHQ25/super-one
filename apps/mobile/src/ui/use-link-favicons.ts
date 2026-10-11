import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findWebLinks } from '@superone/shared/web-links'
import { answeredLinkFavicon, cachedLinkFavicon, linkOrigin } from '../link-favicons'
import { WEB_LINK_GLOBE, faviconArtworkKey, faviconPng } from '../composer-web-links'
import type { MentionArtwork } from './mention-artwork'
import { mentionGlyphArtwork } from './mention-glyph-data'
import type { MobileColorScheme } from '../theme/tokens'

export type FaviconResolver = (href: string, isDark: boolean) => Promise<string | null>

/** Typing a host changes its origin on every keystroke; ask only once the draft rests. */
export const FAVICON_SETTLE_MS = 400

/**
 * Favicons for the draft's links, as native artwork rows plus the key each
 * origin draws. Answers come from the shared origin+scheme cache; the host is
 * asked only for origins still in the draft after it has rested.
 */
export function useLinkFavicons(text: string, scheme: MobileColorScheme, foreground: string, resolve?: FaviconResolver) {
  const isDark = scheme === 'dark'
  const [revision, setRevision] = useState(0)
  const resolver = useRef(resolve)
  resolver.current = resolve
  // First href per origin, in draft order; the key only changes when the set of origins does.
  const hrefs = useMemo(() => {
    const byOrigin = new Map<string, string>()
    for (const { href } of findWebLinks(text)) {
      const origin = linkOrigin(href)
      if (origin && !byOrigin.has(origin)) byOrigin.set(origin, href)
    }
    return JSON.stringify([...byOrigin])
  }, [text])
  useEffect(() => {
    const entries = JSON.parse(hrefs) as Array<[string, string]>
    if (!entries.some(([, href]) => answeredLinkFavicon(href, isDark) === undefined)) return
    let live = true
    const timer = setTimeout(() => {
      for (const [, href] of entries) {
        const ask = resolver.current
        if (!ask || answeredLinkFavicon(href, isDark) !== undefined) continue
        cachedLinkFavicon(href, isDark, ask).then(() => { if (live) setRevision((value) => value + 1) }, () => {})
      }
    }, FAVICON_SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [hrefs, isDark])
  const icons = useMemo(() => {
    void revision
    const entries = JSON.parse(hrefs) as Array<[string, string]>
    const keys = new Map<string, string>()
    const artwork: MentionArtwork[] = []
    for (const [origin, href] of entries) {
      const dataUrl = answeredLinkFavicon(href, isDark)
      const png = dataUrl ? faviconPng(dataUrl) : null
      if (png) { keys.set(origin, faviconArtworkKey(origin)); artwork.push({ key: faviconArtworkKey(origin), png }) }
    }
    const globe = entries.length ? mentionGlyphArtwork(WEB_LINK_GLOBE, scheme, foreground) : undefined
    if (globe) artwork.push({ key: WEB_LINK_GLOBE, png: globe })
    return { keys, artwork }
  }, [hrefs, isDark, scheme, foreground, revision])
  const iconFor = useCallback((origin: string) => icons.keys.get(origin) ?? WEB_LINK_GLOBE, [icons])
  return { artwork: icons.artwork, iconFor }
}
