import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
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

export function SessionChip({ href, label }: { href: string; label: string }) {
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
  if (!parsed) return <span>{label}</span>
  const currentMetadata = metadata && targetKey === buildSessionLink(metadata.ref) ? metadata : null
  const Icon = currentMetadata ? resolveSessionIcon(currentMetadata.harness, currentMetadata.acpAgentId) : null
  const title = currentMetadata?.environmentLabel ? `${label} · ${currentMetadata.environmentLabel}` : label
  return (
    <a ref={element} href={targetKey ?? href} title={title} aria-label={label} aria-busy={opening || undefined}
      aria-disabled={!target || !ports || opening || undefined}
      data-selection-fill="" data-selection-atomic="" data-copy-text={sessionLinkMarkdown(label, target ?? parsed)}
      className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring transition-colors"
      onClick={async event => {
        event.preventDefault(); event.stopPropagation()
        // Keyboard activation is independent of an existing text selection.
        if ((event.detail !== 0 && globalThis.getSelection?.()?.toString()) || busy.current) return
        if (!target || !ports) { ports?.onError(new Error('Session source environment is unavailable')); return }
        busy.current = true; setOpening(true)
        try { await ports.open(target) } catch (error) { ports.onError(error) }
        finally { busy.current = false; setOpening(false) }
      }}>
      <span aria-hidden="true" className="flex size-3 shrink-0 items-center justify-center">
        {opening ? <Loader2 className="size-3 animate-spin" /> : Icon ? <Icon status="default" size={12} renderLevel="compact" /> : <MessageSquare className="size-3 text-muted-foreground" />}
      </span>
      <span className="min-w-0 max-w-[24em] truncate">{label}</span>
    </a>
  )
}

export function sessionChipLabel(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(sessionChipLabel).join('')
  if (children && typeof children === 'object' && 'props' in children) return sessionChipLabel((children.props as { children?: ReactNode }).children)
  return ''
}
