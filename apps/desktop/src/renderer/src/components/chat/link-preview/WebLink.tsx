import { useState, type AnchorHTMLAttributes, type ReactElement } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { cn } from '@superone/ui/lib/utils'
import { LinkFaviconPresenter, isHttpHref, type LinkFaviconPorts } from '@superone/chat-view/presenters/LinkFavicon'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { useIsDark } from '@/hooks/use-is-dark'
import { tryCopy } from '@/lib/clipboard'
import { requestOpenExternalLink } from '@/lib/external-link'
import { LinkPreviewCard } from './LinkPreviewCard'
import { useLinkPreview } from './link-preview-loader'

const faviconPorts: LinkFaviconPorts = {
  resolveFavicon: (href, isDark) => window.app.resolveFavicon(href, isDark),
}

export function LinkFavicon({ href }: { href: string }) {
  const isDark = useIsDark()
  return <LinkFaviconPresenter href={href} isDark={isDark} ports={faviconPorts} />
}

/** The preview card's surface, shared by the hover card and the composer's anchored card. */
export const LINK_PREVIEW_SURFACE = 'w-[min(22rem,80vw)] overflow-hidden rounded-xl p-0'

/** A link's preview card, loading its summary while `open`; it closes once the link is opened. */
export function LinkPreviewContent({ href, open, onClose }: { href: string; open: boolean; onClose: () => void }) {
  const state = useLinkPreview(href, open)
  return (
    <LinkPreviewCard
      href={href}
      state={state}
      favicon={<LinkFavicon href={href} />}
      onOpenInApp={() => { openBrowserTab(href); onClose() }}
      // The card already names the destination and this is an explicit choice, so it skips the click confirmation.
      onOpenExternal={() => { window.app.openExternalLink(href); onClose() }}
      onCopy={() => tryCopy(href)}
    />
  )
}

/** Hovering `children` (an anchor) shows the link's preview card. */
export function WebLinkHoverCard({ href, children }: { href: string; children: ReactElement }) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className={LINK_PREVIEW_SURFACE}>
        <LinkPreviewContent href={href} open={open} onClose={() => setOpen(false)} />
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * A web link as chat draws it: the site's favicon, a click opens it in the
 * default browser (after the link confirmation) and ⌘/Ctrl-click in the
 * built-in one, and hovering an http(s) link previews the page.
 */
export function WebLink({ href, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const anchor = (
    <a
      href={href}
      className={cn(className, 'no-underline hover:underline hover:decoration-1 hover:underline-offset-2')}
      {...rest}
      onClick={(e) => {
        if (!href) return
        e.preventDefault()
        const openInApp = window.app.platform === 'darwin' ? e.metaKey : e.ctrlKey
        if (openInApp) {
          openBrowserTab(href)
          return
        }
        requestOpenExternalLink(href)
      }}
    >
      {href && <LinkFavicon href={href} />}
      {children}
    </a>
  )
  return href && isHttpHref(href) ? <WebLinkHoverCard href={href}>{anchor}</WebLinkHoverCard> : anchor
}
