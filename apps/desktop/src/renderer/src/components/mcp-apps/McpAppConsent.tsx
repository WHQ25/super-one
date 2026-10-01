import { useTranslation } from 'react-i18next'
import type { McpAppApprovalPrompt } from '@superone/shared/mcp-apps'
import { Button } from '@superone/ui/components/ui/button'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@superone/ui/components/ui/dialog'

export interface PendingMcpConsent { id: string; prompt: McpAppApprovalPrompt; finish(value: Record<string, never> | null): void }

export function McpAppConsent({ pending }: { pending?: PendingMcpConsent }) {
  const { t } = useTranslation()
  if (!pending) return null
  const { prompt, finish } = pending
  const preview = prompt.text
  return <Dialog open onOpenChange={open => { if (!open) finish(null) }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t(prompt.target === 'new' ? 'mcpApp.approveNewMessage' : 'mcpApp.approveMessage', { server: prompt.server })}</DialogTitle>
        <DialogDescription>{prompt.target === 'new' ? t('mcpApp.newConversation') : prompt.server}</DialogDescription>
      </DialogHeader>
      {preview && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{preview}</pre>}
      <ContextAttachments items={prompt.items ?? []} />
      {prompt.nonTextBlocks > 0 && <p className="text-xs text-muted-foreground">{t('mcpApp.nonText', { count: prompt.nonTextBlocks })}</p>}
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" onClick={() => finish(null)}>{t('mcpApp.deny')}</Button>
        <Button onClick={() => finish({})}>{t('mcpApp.allow')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
