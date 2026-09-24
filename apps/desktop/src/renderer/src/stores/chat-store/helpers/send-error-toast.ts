import { toast } from 'sonner'
import i18n from 'i18next'
import { isTransportSendError } from '@superone/shared/send-failure'

const CURSOR_API_KEY_MISSING_RE = /Cursor User API Key missing/i

export function isRemoteTransportSendError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return isTransportSendError(msg)
}

/** True when Cursor SDK/runtime rejected the turn for a missing User API Key. */
export function isCursorApiKeyMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return CURSOR_API_KEY_MISSING_RE.test(msg)
}

/** A missing Cursor key is fixed in a prompt, not read off an error. True when it opened. */
export function promptForMissingCursorKey(err: unknown): boolean {
  if (!isCursorApiKeyMissingError(err)) return false
  // Lazy import avoids chat-store ↔ helper cycles (send-message → this file).
  void import('../index').then(({ useChatStore }) => {
    useChatStore.getState().openCursorApiKeyPrompt()
  })
  return true
}

/** Surface a failure of an action that has no transcript row to carry it. */
export function toastSendFailure(err: unknown): void {
  if (promptForMissingCursorKey(err)) return
  const msg = err instanceof Error ? err.message : String(err)
  if (isRemoteTransportSendError(err)) {
    toast.error(i18n.t('chat.send.remoteUnavailable'))
    return
  }
  toast.error(i18n.t('chat.send.failed', { message: msg || 'unknown error' }))
}
