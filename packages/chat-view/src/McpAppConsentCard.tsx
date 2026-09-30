import { useTranslation } from 'react-i18next'
import type { McpAppApprovalPrompt } from './mcp-app-executor'

export type McpAppConsentRequest =
  | { kind: 'approval'; prompt: McpAppApprovalPrompt; resolve: (decision: { remember: boolean } | null) => void }
  | { kind: 'link'; url: string; resolve: (open: boolean) => void }

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
 * A confirmation for something an MCP App View asked for. It is drawn by the chat document,
 * outside the View's frame, so the View can neither draw nor click it. Every field is text
 * the host produced and is shown as plain text, never as markup.
 */
export function McpAppConsentCard({ request }: { request: McpAppConsentRequest }) {
  const { t } = useTranslation()
  const detail = 'rounded bg-background/60 px-2 py-1.5 text-xs text-foreground whitespace-pre-wrap break-words'
  if (request.kind === 'link') {
    return (
      <div role="dialog" aria-label={t('mcpApp.openLink')} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
        <p className="text-sm text-foreground">{t('mcpApp.openLink')}</p>
        <p className={`${detail} font-mono`}>{request.url}</p>
        <div className="flex justify-end gap-2">
          <Action label={t('common.cancel')} onPress={() => request.resolve(false)} />
          <Action primary label={t('mcpApp.open')} onPress={() => request.resolve(true)} />
        </div>
      </div>
    )
  }
  const { prompt, resolve } = request
  if (prompt.kind === 'sendMessage') {
    return (
      <div role="dialog" aria-label={t('mcpApp.sendMessage', { server: prompt.server })} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
        <p className="text-sm text-foreground">{t('mcpApp.sendMessage', { server: prompt.server })}</p>
        <p className={`${detail} max-h-40 overflow-y-auto`}>{prompt.text}</p>
        {prompt.nonTextBlocks > 0 ? (
          <p className="text-xs text-muted-foreground">{t('mcpApp.nonTextBlocks', { count: prompt.nonTextBlocks })}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Action label={t('common.cancel')} onPress={() => resolve(null)} />
          <Action primary label={t('mcpApp.send')} onPress={() => resolve({ remember: false })} />
        </div>
      </div>
    )
  }
  const tool = prompt.toolTitle ?? prompt.tool
  return (
    <div role="dialog" aria-label={t('mcpApp.approveTool', { server: prompt.server, tool })} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
      <p className="text-sm text-foreground">{t('mcpApp.approveTool', { server: prompt.server, tool })}</p>
      <pre className={`${detail} max-h-40 overflow-y-auto font-mono`}>{prompt.argsPreview}</pre>
      <div className="flex flex-wrap justify-end gap-2">
        <Action label={t('mcpApp.deny')} onPress={() => resolve(null)} />
        {prompt.rememberable ? <Action label={t('mcpApp.alwaysAllow')} onPress={() => resolve({ remember: true })} /> : null}
        <Action primary label={t('mcpApp.allowOnce')} onPress={() => resolve({ remember: false })} />
      </div>
    </div>
  )
}
