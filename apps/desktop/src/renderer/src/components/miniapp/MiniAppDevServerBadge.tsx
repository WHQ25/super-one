import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const POLL_MS = 3_000

/**
 * The dev server a development app is hot-reloading from, or null while it
 * serves its build. The agent starts and stops the server in a terminal, so the
 * answer is polled while the tab is mounted.
 */
function useMiniAppDevServer(appId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      void window.miniapp.devServer(appId).then((next) => {
        if (!cancelled) setUrl(next)
      }, () => {})
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [appId])

  return url
}

/** Marks a development app's tab while its pages come from a live dev server rather than its build. */
export function MiniAppDevServerBadge({ appId }: { appId: string }) {
  const { t } = useTranslation()
  const url = useMiniAppDevServer(appId)
  if (!url) return null
  const label = t('activity.miniAppDevServer', { url })
  return (
    <span
      data-miniapp-dev-server=""
      role="img"
      aria-label={label}
      title={label}
      className="ml-0.5 flex size-4 shrink-0 items-center justify-center text-success"
    >
      <Zap className="size-3" />
    </span>
  )
}
