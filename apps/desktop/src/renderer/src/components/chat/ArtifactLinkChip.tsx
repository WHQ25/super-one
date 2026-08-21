import { ExternalLink } from 'lucide-react'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { requestOpenExternalLink } from '@/lib/external-link'

/**
 * Clickable chip for an `Artifact` tool row's URL. Modifier semantics match
 * chat markdown links (`chat-markdown-components`): plain click goes through
 * the external-link confirm, modifier-click opens an in-app browser tab.
 */
export function ArtifactLinkChip({ url, label }: { url: string; label: string }) {
  return (
    <span
      role="button"
      title={url}
      onClick={(e) => {
        // The row itself toggles expand — opening a link must not also do that.
        e.stopPropagation()
        const openInApp = window.app.platform === 'darwin' ? e.metaKey : e.ctrlKey
        if (openInApp) openBrowserTab(url)
        else requestOpenExternalLink(url)
      }}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground transition-colors hover:bg-muted/80"
    >
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </span>
  )
}
