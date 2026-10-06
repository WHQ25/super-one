import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSymlink, MessageSquareShare } from 'lucide-react'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'
import { cn } from '@superone/ui/lib/utils'
import { PermissionActionButton } from '@/components/chat/PermissionActionBar'
import { useMcpAppConsents, type PendingMcpConsent } from './consent-store'

interface McpAppConsentPromptProps {
  pending: PendingMcpConsent
  /** False when the host surface already draws the card (the collapsed floating chat). */
  framed?: boolean
  /** Settled and on its way out of the slot: shown, but no longer answerable. */
  stale?: boolean
}

/**
 * An App's request to send a message, or to open a file outside the project, asked in
 * the composer slot it replaces.
 * Enter is never bound: the slot can swap in while the user is typing, and a
 * keystroke meant for the chat must not send on the App's behalf. Escape declines.
 */
export function McpAppConsentPrompt({ pending, framed = true, stale = false }: McpAppConsentPromptProps) {
  const { t } = useTranslation()
  const { prompt, finish } = pending
  const message = prompt.kind === 'sendMessage' ? prompt : undefined
  const Icon = message ? MessageSquareShare : FileSymlink
  const detail = prompt.kind === 'sendMessage' ? prompt.text : prompt.path
  const root = useRef<HTMLDivElement>(null)
  // Swapping the chat input out drops its focus on the floor; pick it up so Escape
  // works, but never pull focus from wherever the user moved it.
  useEffect(() => {
    if (!stale && (document.activeElement === null || document.activeElement === document.body)) root.current?.focus({ preventScroll: true })
  }, [pending.id, stale])
  return <div
    ref={root}
    tabIndex={-1}
    inert={stale}
    data-mcp-app-consent=""
    className={cn('outline-none', framed && 'mx-3 mb-1')}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      finish(null)
    }}
  >
    <div className={cn('overflow-hidden', framed && 'rounded-xl border border-border bg-card shadow-sm')}>
      <div className="flex items-start gap-3 border-b border-border/60 px-3.5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[22%] bg-muted ring-1 ring-border">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {message ? t(message.target === 'new' ? 'mcpApp.approveNewMessage' : 'mcpApp.approveMessage', { server: prompt.server }) : t('mcpApp.approveOpenFile')}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{message?.target === 'new' ? t('mcpApp.newConversation') : prompt.server}</div>
        </div>
      </div>
      <div className="space-y-2 px-3.5 py-3">
        {detail && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 px-2.5 py-2 text-xs">{detail}</pre>}
        {message && <ContextAttachments items={message.items ?? []} />}
        {!!message?.nonTextBlocks && <p className="text-xs text-muted-foreground">{t('mcpApp.nonText', { count: message.nonTextBlocks })}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <PermissionActionButton tone="approve" onClick={() => finish({})}>{t('mcpApp.allow')}</PermissionActionButton>
          <PermissionActionButton tone="reject" kbd="esc" onClick={() => finish(null)}>{t('mcpApp.deny')}</PermissionActionButton>
        </div>
      </div>
    </div>
  </div>
}

/** The session's oldest pending App message approval, as a composer. */
export function McpAppConsentComposer({ sessionId, framed, pending }: { sessionId: string; framed?: boolean; pending?: PendingMcpConsent }) {
  const head = useMcpAppConsents(state => state.pending.find(item => item.sessionId === sessionId))
  // The slot animates the composer out after it settles; keep drawing the last one until then.
  const [shown, setShown] = useState(head)
  if (!pending && head && head !== shown) setShown(head)
  const displayed = pending ?? shown
  if (!displayed) return null
  return <McpAppConsentPrompt key={displayed.id} pending={displayed} framed={framed} stale={displayed.id !== head?.id} />
}
