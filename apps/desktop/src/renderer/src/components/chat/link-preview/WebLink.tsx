import type { AnchorHTMLAttributes, PointerEvent, ReactElement } from 'react'
import { Slot } from 'radix-ui'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import { FaviconLinkBody, LinkFaviconPresenter, isHttpHref, type LinkFaviconPorts } from '@superone/chat-view/presenters/LinkFavicon'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { useIsDark } from '@/hooks/use-is-dark'
import { tryCopy } from '@/lib/clipboard'
import { requestOpenExternalLink } from '@/lib/external-link'
import { LinkPreviewCard } from './LinkPreviewCard'
import { useLinkPreview } from './link-preview-loader'
import { useLinkPreviewHover } from './use-link-preview-hover'

const faviconPorts: LinkFaviconPorts = {
  resolveFavicon: (href, isDark) => window.app.resolveFavicon(href, isDark),
}

export function LinkFavicon({ href }: { href: string }) {
  const isDark = useIsDark()
  return <LinkFaviconPresenter href={href} isDark={isDark} ports={faviconPorts} />
}

/** The preview card's surface, shared by chat links and the composer. */
export const LINK_PREVIEW_SURFACE = 'w-[min(22rem,80vw)] overflow-hidden rounded-xl p-0'
export const LINK_PREVIEW_GAP = 8

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
  const { open, anchor, hover, keepOpen, close, scheduleClose } = useLinkPreviewHover()
  const onPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') hover(href, event.currentTarget, event)
  }
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) close() }}>
      <PopoverAnchor virtualRef={anchor} />
      <Slot.Root
        data-state={open ? 'open' : 'closed'}
        onPointerEnter={onPointer}
        onPointerMove={onPointer}
        onPointerLeave={scheduleClose}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) hover(href, event.currentTarget)
        }}
        onBlur={scheduleClose}
      >
        {children}
      </Slot.Root>
      <PopoverContent
        align="center"
        sideOffset={LINK_PREVIEW_GAP}
        className={cn(LINK_PREVIEW_SURFACE, 'bg-popover dark:bg-popover backdrop-blur-none')}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={keepOpen}
        onPointerLeave={scheduleClose}
        onFocusCapture={keepOpen}
      >
        <LinkPreviewContent href={href} open={open} onClose={close} />
      </PopoverContent>
    </Popover>
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
      <FaviconLinkBody favicon={href && <LinkFavicon href={href} />}>{children}</FaviconLinkBody>
    </a>
  )
  return href && isHttpHref(href) ? <WebLinkHoverCard href={href}>{anchor}</WebLinkHoverCard> : anchor
}
