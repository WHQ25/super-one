import { useTranslation } from 'react-i18next'
import type { McpAppApprovalPrompt } from '@superone/shared/mcp-apps'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@superone/ui/components/ui/dialog'

export interface PendingMcpConsent { id: string; prompt: McpAppApprovalPrompt; finish(value: { remember?: boolean } | null): void }

export function McpAppConsent({ pending }: { pending?: PendingMcpConsent }) {
  const { t } = useTranslation()
  if (!pending) return null
  const { prompt, finish } = pending
  const preview = prompt.kind === 'callTool' ? prompt.argsPreview : prompt.kind === 'sendMessage' ? prompt.text : prompt.url
  return <Dialog open onOpenChange={open => { if (!open) finish(null) }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t(`mcpApp.approve${prompt.kind === 'callTool' ? 'Tool' : prompt.kind === 'sendMessage' ? 'Message' : 'Link'}`, { server: prompt.server, tool: prompt.kind === 'callTool' ? prompt.toolTitle ?? prompt.tool : '' })}</DialogTitle>
        <DialogDescription>{prompt.server}{prompt.kind === 'callTool' ? ` · ${prompt.toolTitle ?? prompt.tool}` : ''}</DialogDescription>
      </DialogHeader>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{preview}</pre>
      {prompt.kind === 'sendMessage' && prompt.nonTextBlocks > 0 && <p className="text-xs text-muted-foreground">{t('mcpApp.nonText', { count: prompt.nonTextBlocks })}</p>}
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" onClick={() => finish(null)}>{t('mcpApp.deny')}</Button>
        {prompt.kind === 'callTool' && prompt.rememberable && <Button variant="secondary" onClick={() => finish({ remember: true })}>{t('mcpApp.remember')}</Button>}
        <Button onClick={() => finish({})}>{t('mcpApp.allow')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
