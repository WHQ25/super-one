import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { CollaborationMailboxMessage } from '@superone/shared/collaboration-mailbox'
import { CopyableMarkdown } from '../CopyableMarkdown'

export function StatusBarMailbox({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation()
  const [state, setState] = useState<{ sessionId: string; messages: CollaborationMailboxMessage[] } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
    if (!sessionId) return
    let disposed = false
    let version = 0
    const refresh = async (): Promise<void> => {
      const request = ++version
      try {
        const messages = await window.app.collaborationMailbox.list(sessionId)
        if (disposed || request !== version) return
        setState({ sessionId, messages })
        if (messages.length === 0) setOpen(false)
      } catch (error) {
        console.warn('[StatusBarMailbox] Failed to load mailbox', error)
      }
    }
    const unsubscribe = window.app.collaborationMailbox.onChanged((changedSessionId) => {
      if (changedSessionId === sessionId) void refresh()
    })
    void refresh()
    return () => { disposed = true; unsubscribe() }
  }, [sessionId])

  const messages = state?.sessionId === sessionId ? state.messages : []
  if (messages.length === 0) return null

  const label = t('chat.collaboration.mailboxReady')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`${label} (${messages.length})`}>
          <Inbox data-icon="inline-start" />
          <span>{messages.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96 max-w-[calc(100vw-2rem)] p-0" aria-label={label}>
        <div className="px-3 py-2 text-sm font-medium">{label} ({messages.length})</div>
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {messages.map((message) => (
            <div key={message.id}>
              <article className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate" title={message.fromTitle}>{message.fromTitle}</span>
                  <time className="shrink-0" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <div className="min-w-0 break-words text-sm">
                  <CopyableMarkdown text={message.content} isStreaming={false} />
                </div>
              </article>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
