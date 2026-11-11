import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSymlink, MessageSquareShare, Wrench } from 'lucide-react'
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
  const appTool = prompt.kind === 'callAppTool' ? prompt : undefined
  const Icon = appTool ? Wrench : message ? MessageSquareShare : FileSymlink
  const detail = prompt.kind === 'sendMessage'
    ? prompt.text
    : prompt.kind === 'openFile'
      ? prompt.path
      : prompt.argsPreview !== '{}' ? prompt.argsPreview : ''
  const badges: Array<{ key: string; label: string; destructive?: boolean }> = []
  if (appTool?.annotations?.readOnlyHint) badges.push({ key: 'ro', label: t('mcpApp.readOnlyBadge') })
  if (appTool?.annotations?.destructiveHint) badges.push({ key: 'dest', label: t('mcpApp.destructiveBadge'), destructive: true })
  if (appTool?.annotations?.openWorldHint) badges.push({ key: 'ow', label: t('mcpApp.openWorldBadge') })
  if (appTool?.annotations?.idempotentHint) badges.push({ key: 'idem', label: t('mcpApp.idempotentBadge') })
  const root = useRef<HTMLDivElement>(null)
  // Swapping the chat input out drops its focus on the floor; pick it up so Escape
  // works, but never pull focus from wherever the user moved it.
  useEffect(() => {
    if (!stale && (document.activeElement === null || document.activeElement === document.body)) root.current?.focus({ preventScroll: true })
  }, [pending.id, stale])
  const hasBody = Boolean(detail || message || appTool?.description || badges.length > 0 || appTool?.schemaFallback)
  return <div
    ref={root}
    tabIndex={-1}
    inert={stale}
    data-mcp-app-consent=""
    className={cn('flex min-h-0 flex-col outline-none', framed && 'mx-3 mb-1')}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      finish(null)
    }}
  >
    <div className={cn('flex min-h-0 flex-col overflow-hidden', framed && 'rounded-xl border border-border bg-card shadow-sm')}>
      <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-3.5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[22%] bg-muted ring-1 ring-border">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {appTool
              ? t('mcpApp.approveAppTool')
              : message
                ? t(message.target === 'new' ? 'mcpApp.approveNewMessage' : 'mcpApp.approveMessage', { server: prompt.server })
                : t('mcpApp.approveOpenFile')}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {appTool
              ? t('mcpApp.appToolPrompt', { tool: appTool.toolTitle || appTool.toolName, server: prompt.server })
              : message?.target === 'new'
                ? t('mcpApp.newConversation')
                : prompt.server}
          </div>
        </div>
      </div>
      {hasBody && (
        <div className="min-h-0 space-y-2 overflow-y-auto px-3.5 pt-3">
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {badges.map(badge => (
                <span
                  key={badge.key}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1',
                    badge.destructive
                      ? 'bg-error/10 text-error ring-error/30'
                      : 'bg-muted text-muted-foreground ring-border',
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
          {appTool?.description && <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{appTool.description}</p>}
          {detail && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 px-2.5 py-2 text-xs">{detail}</pre>}
          {appTool?.schemaFallback && <p className="text-xs text-muted-foreground">{t('mcpApp.schemaUnverified')}</p>}
          {message && <ContextAttachments items={message.items ?? []} />}
          {!!message?.nonTextBlocks && <p className="text-xs text-muted-foreground">{t('mcpApp.nonText', { count: message.nonTextBlocks })}</p>}
        </div>
      )}
      <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-3.5 pb-3', hasBody ? 'pt-2' : 'pt-3')}>
        <PermissionActionButton tone="approve" onClick={() => finish({})}>{t('mcpApp.allow')}</PermissionActionButton>
        {appTool?.allowAlwaysAllow && (
          <PermissionActionButton tone="approve" onClick={() => finish({ alwaysAllow: true })}>{t('mcpApp.alwaysAllow')}</PermissionActionButton>
        )}
        <PermissionActionButton tone="reject" kbd="esc" onClick={() => finish(null)}>{t('mcpApp.deny')}</PermissionActionButton>
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
