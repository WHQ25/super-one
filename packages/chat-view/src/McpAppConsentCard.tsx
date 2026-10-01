import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpAppApprovalPrompt } from '@superone/shared/mcp-apps'

export interface McpAppConsentRequest {
  prompt: McpAppApprovalPrompt
  /** `null` declines; `remember` asks the host to keep a tool approval. */
  resolve: (decision: { remember: boolean } | null) => void
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
  if (prompt.kind === 'openLink') {
    return (
      <ConsentDialog label={t('mcpApp.openLink')}>
        <p className="text-sm text-foreground">{t('mcpApp.openLink')}</p>
        <p className={`${detail} font-mono`}>{prompt.url}</p>
        <div className="flex justify-end gap-2">
          <Action label={t('common.cancel')} onPress={() => resolve(null)} />
          <Action primary label={t('mcpApp.open')} onPress={() => resolve({ remember: false })} />
        </div>
      </ConsentDialog>
    )
  }
  if (prompt.kind === 'sendMessage') {
    return (
      <ConsentDialog label={t('mcpApp.sendMessage', { server: prompt.server })}>
        <p className="text-sm text-foreground">{t('mcpApp.sendMessage', { server: prompt.server })}</p>
        <p className={`${detail} max-h-40 overflow-y-auto`}>{prompt.text}</p>
        {prompt.nonTextBlocks > 0 ? (
          <p className="text-xs text-muted-foreground">{t('mcpApp.nonTextBlocks', { count: prompt.nonTextBlocks })}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Action label={t('common.cancel')} onPress={() => resolve(null)} />
          <Action primary label={t('mcpApp.send')} onPress={() => resolve({ remember: false })} />
        </div>
      </ConsentDialog>
    )
  }
  const tool = prompt.toolTitle ?? prompt.tool
  return (
    <ConsentDialog label={t('mcpApp.approveTool', { server: prompt.server, tool })}>
      <p className="text-sm text-foreground">{t('mcpApp.approveTool', { server: prompt.server, tool })}</p>
      <pre className={`${detail} max-h-40 overflow-y-auto font-mono`}>{prompt.argsPreview}</pre>
      <div className="flex flex-wrap justify-end gap-2">
        <Action label={t('mcpApp.deny')} onPress={() => resolve(null)} />
        {prompt.rememberable ? <Action label={t('mcpApp.alwaysAllow')} onPress={() => resolve({ remember: true })} /> : null}
        <Action primary label={t('mcpApp.allowOnce')} onPress={() => resolve({ remember: false })} />
      </div>
    </ConsentDialog>
  )
}
