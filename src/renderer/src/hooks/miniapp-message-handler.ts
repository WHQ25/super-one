import { useChatStore } from '@/stores/chat'
import { requestOpenExternalLink } from '@/lib/external-link'
import { requestClipboardRead, requestClipboardWrite } from '@/lib/miniapp-clipboard'

export function handleMiniAppMessage(
  type: string,
  data: Record<string, unknown>,
  appId: string,
  send: (msg: unknown) => void,
): boolean {
  switch (type) {
    case 'miniapp-tool-result':
      window.miniapp.toolResult(data.callId as string, data.result, data.error as string | undefined)
      return true
    case 'miniapp-sendPrompt':
      if (typeof data.text === 'string') {
        useChatStore.getState().setDraftText(data.text)
      }
      return true
    case 'miniapp-fs-request':
      window.miniapp
        .fsRequest((data.appId as string) ?? appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-fs-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-fs-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-git-request':
      window.miniapp
        .gitRequest(appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-git-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-git-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-fs-watch':
      window.miniapp
        .fsWatch(appId, data.path as string)
        .then((watchId) => { send({ type: 'miniapp-fs-watch-ack', id: data.id, watchId }) })
        .catch((err: unknown) => { send({ type: 'miniapp-fs-watch-ack', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-fs-unwatch':
      window.miniapp.fsUnwatch(data.watchId as number)
      return true
    case 'miniapp-open-folder':
      if (typeof data.path === 'string') {
        window.miniapp.fsRequest(appId, 'showInFolder', { path: data.path })
      }
      return true
    case 'miniapp-open-external-link':
      if (typeof data.url === 'string') requestOpenExternalLink(data.url)
      return true
    case 'miniapp-clipboard-read':
      requestClipboardRead(appId)
        .then((text) => { send({ type: 'miniapp-clipboard-response', id: data.id, text }) })
        .catch((err: unknown) => { send({ type: 'miniapp-clipboard-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-clipboard-write':
      if (typeof data.text === 'string') requestClipboardWrite(appId, data.text)
      return true
    default:
      return false
  }
}
