import { useEffect, useState } from 'react'
import type { BrowserHistoryEntry } from '@superone/shared/agent-types'
import { useBrowserBookmarksStore } from '@/stores/browser-bookmarks'
import { normalizeUrl } from './browser-url'

export type OmniboxKind = 'url' | 'search' | 'bookmark' | 'history'

export interface OmniboxSuggestion {
  id: string
  kind: OmniboxKind
  primary: string
  secondary?: string
  url: string
  favicon?: string | null
}

const MAX_SUGGESTIONS = 8

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

function useHistorySuggestions(query: string, enabled: boolean): BrowserHistoryEntry[] {
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>([])
  useEffect(() => {
    if (!enabled) { setEntries([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.app.suggestBrowserHistory(query, MAX_SUGGESTIONS).then((res) => {
        if (!cancelled) setEntries(res)
      })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, enabled])
  return entries
}

export function useOmniboxSuggestions(query: string, enabled: boolean): OmniboxSuggestion[] {
  const bookmarks = useBrowserBookmarksStore((s) => s.bookmarks)
  const history = useHistorySuggestions(query, enabled)

  const q = query.trim().toLowerCase()
  const out: OmniboxSuggestion[] = []
  if (!enabled) return out
  const seen = new Set<string>()

  const push = (s: OmniboxSuggestion) => {
    if (seen.has(s.url) || out.length >= MAX_SUGGESTIONS) return
    seen.add(s.url)
    out.push(s)
  }

  if (q) {
    const resolved = normalizeUrl(query)
    const isSearch = resolved.startsWith('https://www.google.com/search?q=')
    push(isSearch
      ? { id: 'typed', kind: 'search', primary: query, secondary: undefined, url: resolved }
      : { id: 'typed', kind: 'url', primary: query, secondary: stripScheme(resolved), url: resolved })

    for (const h of history) {
      push({ id: `his-${h.url}`, kind: 'history', primary: h.title || stripScheme(h.url), secondary: stripScheme(h.url), url: h.url })
    }
    for (const b of bookmarks) {
      if (b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
        push({ id: `bm-${b.id}`, kind: 'bookmark', primary: b.title || stripScheme(b.url), secondary: stripScheme(b.url), url: b.url, favicon: b.favicon })
      }
    }
  } else {
    for (const h of history) {
      push({ id: `his-${h.url}`, kind: 'history', primary: h.title || stripScheme(h.url), secondary: stripScheme(h.url), url: h.url })
    }
    for (const b of bookmarks.slice(0, 4)) {
      push({ id: `bm-${b.id}`, kind: 'bookmark', primary: b.title || stripScheme(b.url), secondary: stripScheme(b.url), url: b.url, favicon: b.favicon })
    }
  }

  return out
}
