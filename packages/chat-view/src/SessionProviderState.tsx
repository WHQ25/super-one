import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, ShipWheel, ListOrdered, X } from 'lucide-react'
import type { HarnessConnectionState, SessionInboxItem } from '@superone/shared/session-inbox'

export type SessionInboxAction = 'cancel' | 'steer' | 'queue'

/** Shared desktop/WebView state; native inputs are already accepted by the provider. */
export function SessionProviderState({ items = [], connection, disabled = false, onAction, onReconnect }: {
  items?: SessionInboxItem[]
  connection?: HarnessConnectionState | null
  disabled?: boolean
  onAction(id: string, action: SessionInboxAction): Promise<unknown>
  onReconnect?: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const recovering = connection?.state === 'recovering'
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(id); setError('')
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : t('chat.nativeInbox.failed')) }
    finally { inFlight.current = false; setBusy(null) }
  }
  const act = (id: string, action: SessionInboxAction) => run(id, () => onAction(id, action))
  const disconnected = connection?.state === 'disconnected'
  if (!items.length && !recovering && !disconnected && !error) return null
  return <div className="my-2 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm" data-session-provider-state>
    {recovering && <div className="flex items-center gap-2 text-muted-foreground" role="status">
      <LoaderCircle className="size-4 shrink-0 animate-spin" />{t('chat.nativeInbox.recovering', { attempt: connection.attempt })}
    </div>}
    {disconnected && <div className="flex flex-wrap items-center gap-2" role="alert">
      <span className="text-destructive">{t('chat.nativeInbox.disconnected')}</span>
      {onReconnect && <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={busy !== null}
        onClick={() => void run('connection', onReconnect)}>{t('common.retry')}</button>}
    </div>}
    {items.length > 0 && <p className="font-medium">{t('chat.nativeInbox.title')}</p>}
    {items.map((item) => <div key={item.id} className="rounded-md border bg-background p-2" data-native-inbox={item.id}>
      <p className="line-clamp-3 whitespace-pre-wrap break-words">{item.text || t('chat.nativeInbox.attachedInput')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t(item.delivery === 'steer' ? 'chat.nativeInbox.steer' : 'chat.nativeInbox.queue')}</span>
        {item.attachmentCount > 0 && <span>{t('chat.nativeInbox.attachments', { count: item.attachmentCount })}</span>}
        <div className="ml-auto flex items-center gap-1">
          {busy === item.id && <LoaderCircle className="size-3 animate-spin" />}
          <button className="rounded p-1.5 hover:bg-muted disabled:opacity-40" disabled={disabled || recovering || disconnected || busy !== null}
            aria-label={t(item.delivery === 'steer' ? 'chat.nativeInbox.toQueue' : 'chat.nativeInbox.toSteer')}
            onClick={() => void act(item.id, item.delivery === 'steer' ? 'queue' : 'steer')}>
            {item.delivery === 'steer' ? <ListOrdered className="size-4" /> : <ShipWheel className="size-4" />}
          </button>
          <button className="rounded p-1.5 hover:bg-muted disabled:opacity-40" disabled={disabled || recovering || disconnected || busy !== null}
            aria-label={t('chat.nativeInbox.cancel')} onClick={() => void act(item.id, 'cancel')}><X className="size-4" /></button>
        </div>
      </div>
    </div>)}
    {disabled && items.length > 0 && <p className="text-xs text-muted-foreground">{t('chat.nativeInbox.controlsUnavailable')}</p>}
    {error && <div className="flex items-start gap-2"><p role="alert" className="flex-1 break-words text-destructive">{error}</p>
      <button aria-label={t('common.close')} onClick={() => setError('')}><X className="size-4" /></button></div>}
  </div>
}
