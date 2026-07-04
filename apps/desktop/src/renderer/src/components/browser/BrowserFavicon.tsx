import { useEffect, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useIsDark } from '@/hooks/use-is-dark'

// Renders a favicon strictly from the shared, origin-keyed main-process cache, which
// returns the icon as a self-contained data URL. A remote favicon URL is NEVER used as
// an `<img src>`: the renderer session has no site cookies/warm connection, so a cold
// fetch of a hotlink-protected CDN icon (e.g. bilibili's `i0.hdslb.com/...`) fails and
// paints a broken image. Live resolution (download → cache) happens once when the page
// loads (`page-favicon-updated`); this component only reads that cache and falls back to
// `fallback` (a globe) on a miss.
//
// `preferSrc` only matters when `src` is itself already a data URL (a live capture the
// caller resolved): it then wins over the origin cache so a just-changed icon shows
// immediately. Any non-data `src` is ignored here.
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

  const dataSrc = src?.startsWith('data:') ? src : null
  const ordered = preferSrc ? [dataSrc, resolved] : [resolved, dataSrc]
  const candidates = ordered.filter((c): c is string => !!c)
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [resolved, dataSrc])

  const current = candidates[idx]
  if (!current) return <>{fallback}</>
  return <img src={current} alt="" className={cn('rounded-sm', className)} onError={() => setIdx((i) => i + 1)} />
}
