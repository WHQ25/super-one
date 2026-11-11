import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpAppMessagePrompt, McpAppToolPrompt } from '@superone/shared/mcp-apps'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'

export type McpAppConsentDecision = boolean | { approved: boolean; alwaysAllow?: boolean }

export interface McpAppConsentRequest {
  prompt: McpAppMessagePrompt | McpAppToolPrompt
  resolve: (decision: McpAppConsentDecision) => void
}

function Action({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`rounded px-3 py-1.5 text-xs ${primary ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
    >
      {label}
    </button>
  )
}

/**
 * The card waits for a decision, so it keeps itself on screen: once it is laid out, and again
 * when the document resizes, which is how the keyboard closing moves the transcript under it.
 */
function ConsentDialog({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const reveal = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }))
    }
    reveal()
    window.addEventListener('resize', reveal)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', reveal)
    }
  }, [])
  return (
    <div ref={ref} role="dialog" aria-label={label} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
      {children}
    </div>
  )
}

/**
 * A confirmation for something an MCP App View asked for. It is drawn by the chat document,
 * outside the View's frame, so the View can neither draw nor click it. Every field is text
 * the host produced and is shown as plain text, never as markup.
 */
export function McpAppConsentCard({ request }: { request: McpAppConsentRequest }) {
  const { t } = useTranslation()
  const detail = 'rounded bg-background/60 px-2 py-1.5 text-xs text-foreground whitespace-pre-wrap break-words'
  const { prompt, resolve } = request
  if (prompt.kind === 'callAppTool') {
    const badges: Array<{ key: string; label: string; destructive?: boolean }> = []
    if (prompt.annotations?.readOnlyHint) badges.push({ key: 'ro', label: t('mcpApp.readOnlyBadge') })
    if (prompt.annotations?.destructiveHint) badges.push({ key: 'dest', label: t('mcpApp.destructiveBadge'), destructive: true })
    if (prompt.annotations?.openWorldHint) badges.push({ key: 'ow', label: t('mcpApp.openWorldBadge') })
    if (prompt.annotations?.idempotentHint) badges.push({ key: 'idem', label: t('mcpApp.idempotentBadge') })
    return (
      <ConsentDialog label={t('mcpApp.approveAppTool')}>
        <p className="text-sm font-medium text-foreground">{t('mcpApp.approveAppTool')}</p>
        <p className="text-xs text-muted-foreground">
          {t('mcpApp.appToolPrompt', { tool: prompt.toolTitle || prompt.toolName, server: prompt.server })}
        </p>
        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {badges.map(badge => (
              <span
                key={badge.key}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.destructive ? 'bg-error/10 text-error' : 'bg-muted text-muted-foreground'}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
        {prompt.description ? <p className="line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">{prompt.description}</p> : null}
        {prompt.argsPreview !== '{}' ? <pre className={`${detail} max-h-40 overflow-y-auto`}>{prompt.argsPreview}</pre> : null}
        {prompt.schemaFallback ? <p className="text-xs text-muted-foreground">{t('mcpApp.schemaUnverified')}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Action label={t('common.cancel')} onPress={() => resolve(false)} />
          {prompt.allowAlwaysAllow ? (
            <Action label={t('mcpApp.alwaysAllow')} onPress={() => resolve({ approved: true, alwaysAllow: true })} />
          ) : null}
          <Action primary label={t('mcpApp.allow')} onPress={() => resolve({ approved: true })} />
        </div>
      </ConsentDialog>
    )
  }
  return (
    <ConsentDialog label={t('mcpApp.sendMessage', { server: prompt.server })}>
      <p className="text-sm text-foreground">{t('mcpApp.sendMessage', { server: prompt.server })}</p>
      {prompt.text && <p className={`${detail} max-h-40 overflow-y-auto`}>{prompt.text}</p>}
      <ContextAttachments items={prompt.items ?? []} />
      {prompt.nonTextBlocks > 0 ? (
        <p className="text-xs text-muted-foreground">{t('mcpApp.nonTextBlocks', { count: prompt.nonTextBlocks })}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Action label={t('common.cancel')} onPress={() => resolve(false)} />
        <Action primary label={t('mcpApp.send')} onPress={() => resolve(true)} />
      </div>
    </ConsentDialog>
  )
}
