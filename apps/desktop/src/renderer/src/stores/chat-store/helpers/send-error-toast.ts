import { toast } from 'sonner'
import i18n from 'i18next'

/** Transport / connectivity failures from remote node RPC or environment host. */
const REMOTE_TRANSPORT_RE =
  /not connected|websocket closed|rpc timeout|heartbeat|connection blocked|network offline|connection removed|environment is not connected|failed_precondition/i

export function isRemoteTransportSendError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return REMOTE_TRANSPORT_RE.test(msg)
}

/** Surface a send failure so fire-and-forget callers still notify the user. */
export function toastSendFailure(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (isRemoteTransportSendError(err)) {
    toast.error(i18n.t('chat.send.remoteUnavailable'))
    return
  }
  toast.error(i18n.t('chat.send.failed', { message: msg || 'unknown error' }))
}
