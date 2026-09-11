import { useLayoutEffect, useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/** Collapsed preview height, matching the `max-h-[50vh]` clamp below. */
const PREVIEW_RATIO = 0.5

export interface CollabTaskBubblePresenterProps {
  /** The rendered markdown body; each host brings its own renderer. */
  children: ReactNode
  /** Trailing node in the label row — the desktop's hover copy button. */
  labelTrailing?: ReactNode
  /** Gesture handlers spread onto the bubble itself (phone long-press menu). */
  bubbleProps?: HTMLAttributes<HTMLDivElement>
  /** Floating menu anchored to the bubble's wrapper; rendered when open. */
  menu?: ReactNode
}

/**
 * The launch task a parent agent handed to this session. Reads as an inbox
 * notification (muted label row) sitting above a user-style bubble whose body is
 * real markdown — clipped to half a screen until expanded. Host-agnostic: the
 * markdown renderer and the copy affordance are ports, the clamp is shared.
 */
export function CollabTaskBubblePresenter({
  children,
  labelTrailing,
  bubbleProps,
  menu,
}: CollabTaskBubblePresenterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Markdown height settles asynchronously (code highlighting, images), so watch
  // the unclipped body instead of measuring once. Measuring the inner element
  // keeps `scrollHeight` honest while the outer wrapper is clamped. The viewport
  // is observed through the document root rather than `window` so the presenter
  // stays inside the chat-view package boundary (no browser singletons).
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const root = el.ownerDocument.documentElement
    const measure = (): void => setOverflowing(el.offsetHeight > root.clientHeight * PREVIEW_RATIO)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  const clipped = overflowing && !expanded

  const handleBodyClick = (e: MouseEvent): void => {
    if (!clipped) return
    // Links, code-copy buttons and text selection keep their own behaviour.
    if ((e.target as HTMLElement).closest('a,button,input,textarea,select')) return
    if ((e.target as HTMLElement).ownerDocument.getSelection()?.toString()) return
    setExpanded(true)
  }

  return (
    <div className="mb-0.5 flex w-0 min-w-full justify-end">
      <div className="group/copy relative flex min-w-0 max-w-[90%] flex-col items-end">
        <div className="mb-1 flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Bot className="size-3 shrink-0 opacity-80" />
          <span className="shrink-0">{t('chat.collaboration.initialTask')}</span>
          {labelTrailing}
        </div>
        <div
          {...bubbleProps}
          className="portable-user-message min-w-0 max-w-full overflow-hidden rounded-xl bg-muted/80 text-sm text-foreground"
        >
          <div
            onClick={handleBodyClick}
            className={cn(
              'min-w-0',
              // Fade the clipped tail out of the bubble itself, so the cut never
              // depends on the chat background matching the bubble fill.
              clipped && 'max-h-[50vh] cursor-pointer overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]',
            )}
          >
            <div ref={bodyRef} className="px-3 py-2">
              {children}
            </div>
          </div>
          {overflowing && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-border/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={cn('size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-180')} />
              <span>{expanded ? t('chat.collaboration.collapseTask') : t('chat.collaboration.expandTask')}</span>
            </button>
          )}
        </div>
        {menu}
      </div>
    </div>
  )
}
