import { useEffect, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useIsDark } from '@/hooks/use-is-dark'
import { faviconForUrl } from './browser-url'

// Renders a favicon backed by the shared, origin-keyed main-process cache — the same
// source chat markdown links resolve through, kept fresh by the in-app browser.
//
// `preferSrc` picks the candidate order: a live browser tab passes it so its own
// `page-favicon-updated` capture (`src`) wins — that is ground truth and re-primes
// the cache, so a changed favicon updates immediately. Bookmarks/omnibox leave it off
// so the freshest cache entry wins over their possibly-stale stored icon. Either way
// the shared cache provides instant paint and `/favicon.ico`/`fallback` back it up.
export function BrowserFavicon({
  src,
  url,
  fallback,
  className,
  preferSrc = false,
}: {
  src?: string | null
  url?: string | null
  fallback: React.ReactNode
  className?: string
  preferSrc?: boolean
}) {
  const isDark = useIsDark()
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    setResolved(null)
    if (!url || !/^https?:\/\//i.test(url)) return
    let cancelled = false
    void window.app.resolveFavicon(url, isDark).then((d) => { if (!cancelled) setResolved(d) })
    return () => { cancelled = true }
  }, [url, isDark])

  const derived = faviconForUrl(url)
  const ordered = preferSrc ? [src, resolved, derived] : [resolved, src, derived]
  const candidates = ordered.filter((c): c is string => !!c)
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [resolved, src, url])

  const current = candidates[idx]
  if (!current) return <>{fallback}</>
  return <img src={current} alt="" className={cn('rounded-sm', className)} onError={() => setIdx((i) => i + 1)} />
}
