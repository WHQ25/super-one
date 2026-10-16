import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { resolveSessionIcon } from '@superone/ui/components/harness/resolve-session-icon'
import type { SessionRef } from '@superone/shared/environment/refs'
import { buildSessionLink, parseSessionLink, resolveSessionLink, sessionLinkMarkdown, type SessionLinkMetadata } from '@superone/shared/session-link'
import type { createSessionLinkCache } from './session-link-cache'

export interface SessionLinkPorts {
  cache: ReturnType<typeof createSessionLinkCache>
  open(ref: SessionRef): Promise<void>
  onError(error: unknown): void
}
export const SessionLinkContext = createContext<{ sourceEnvironmentId?: string | null; ports?: SessionLinkPorts }>({})

const noSubscribe = () => () => {}
const noVersion = () => 0

const CHIP_SIZES = {
  inline: { chip: 'gap-1 rounded px-1 text-[0.9em] align-baseline translate-y-[1px]', icon: 'size-3', px: 12, label: 'max-w-[24em]' },
  /** A chip that stands as a heading of its own, e.g. a launched task's title. */
  title: { chip: 'gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-medium', icon: 'size-4', px: 16, label: '' },
} as const

export function SessionChip({ href, label, size = 'inline', className }: { href: string; label: string; size?: keyof typeof CHIP_SIZES; className?: string }) {
  const sizing = CHIP_SIZES[size]
  const { sourceEnvironmentId, ports } = useContext(SessionLinkContext)
  const version = useSyncExternalStore(ports?.cache.subscribe ?? noSubscribe, ports?.cache.getSnapshot ?? noVersion, noVersion)
  const parsed = parseSessionLink(href)
  const target = parsed && resolveSessionLink(parsed, sourceEnvironmentId)
  const targetKey = target ? buildSessionLink(target) : null
  const [metadata, setMetadata] = useState<SessionLinkMetadata | null>(null)
  const [opening, setOpening] = useState(false)
  const busy = useRef(false)
  const element = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    setMetadata(null)
    if (!target || !ports) return
    let retired = false
    const load = () => {
      void ports.cache.get(target).then(result => {
        if (!retired && result.status === 'ok') setMetadata(result.metadata)
      })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load() }
    })
    if (observer && element.current) observer.observe(element.current)
    else load()
    return () => { retired = true; observer?.disconnect() }
  }, [targetKey, ports, version])
  if (!parsed) return <span className={className}>{label}</span>
  const currentMetadata = metadata && targetKey === buildSessionLink(metadata.ref) ? metadata : null
  const Icon = currentMetadata ? resolveSessionIcon(currentMetadata.harness, currentMetadata.acpAgentId) : null
  const title = currentMetadata?.environmentLabel ? `${label} · ${currentMetadata.environmentLabel}` : label
  return (
    <a ref={element} href={targetKey ?? href} title={title} aria-label={label} aria-busy={opening || undefined}
      aria-disabled={!target || !ports || opening || undefined}
      data-selection-fill="" data-selection-atomic="" data-copy-text={sessionLinkMarkdown(label, target ?? parsed)}
      className={cn('inline-flex max-w-full cursor-pointer items-center bg-muted text-foreground whitespace-nowrap hover:bg-muted/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring transition-colors', sizing.chip, className)}
      onClick={async event => {
        event.preventDefault(); event.stopPropagation()
        // Keyboard activation is independent of an existing text selection.
        if ((event.detail !== 0 && globalThis.getSelection?.()?.toString()) || busy.current) return
        if (!target || !ports) { ports?.onError(new Error('Session source environment is unavailable')); return }
        busy.current = true; setOpening(true)
        try { await ports.open(target) } catch (error) { ports.onError(error) }
        finally { busy.current = false; setOpening(false) }
      }}>
      {/* Layout containment drops the harness marks' nested-span baselines, so the chip
          sits on the icon's bottom edge like a file chip does. */}
      <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center contain-layout', sizing.icon)}>
        {Icon ? <Icon status="default" size={sizing.px} renderLevel="compact" /> : <MessageSquare className={cn(sizing.icon, 'text-muted-foreground')} />}
      </span>
      <span className={cn('min-w-0 truncate', sizing.label)}>{label}</span>
    </a>
  )
}

export function sessionChipLabel(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(sessionChipLabel).join('')
  if (children && typeof children === 'object' && 'props' in children) return sessionChipLabel((children.props as { children?: ReactNode }).children)
  return ''
}
