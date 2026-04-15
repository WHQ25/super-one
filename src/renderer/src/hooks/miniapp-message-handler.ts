import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { requestOpenExternalLink } from '@/lib/external-link'
import { requestClipboardRead, requestClipboardWrite } from '@/lib/miniapp-clipboard'
import { toast } from 'sonner'
import type { MiniAppTooltipRequest, MiniAppContextMenuRequest, MiniAppPopoverShowRequest } from '../../../shared/miniapp-types'

export interface MiniAppOverlayCallbacks {
  onTooltip?: (req: MiniAppTooltipRequest | null) => void
  onContextMenu?: (req: MiniAppContextMenuRequest, respond: (itemId: string | null) => void) => void
  onPopoverShow?: (req: MiniAppPopoverShowRequest, send: (msg: unknown) => void) => void
  onPopoverMsg?: (data: unknown) => void
  onPopoverClose?: () => void
}

export function handleMiniAppMessage(
  type: string,
  data: Record<string, unknown>,
  appId: string,
  send: (msg: unknown) => void,
  overlay?: MiniAppOverlayCallbacks,
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
    case 'miniapp-ui-toast': {
      const msg = data.message as string
      const dispatch: Record<string, (m: string) => void> = {
        success: toast.success, error: toast.error, warning: toast.warning, info: toast.info,
      }
      ;(dispatch[data.toastType as string] ?? toast.info)(msg)
      return true
    }
    case 'miniapp-ui-tooltip-show':
      overlay?.onTooltip?.({
        anchorRect: data.anchorRect as MiniAppTooltipRequest['anchorRect'],
        text: data.text as string,
        side: data.side as MiniAppTooltipRequest['side'],
      })
      return true
    case 'miniapp-ui-tooltip-hide':
      overlay?.onTooltip?.(null)
      return true
    case 'miniapp-ui-contextmenu': {
      const reqId = data.id as number
      if (overlay?.onContextMenu) {
        overlay.onContextMenu(
          { position: data.position as MiniAppContextMenuRequest['position'], items: data.items as MiniAppContextMenuRequest['items'] },
          (itemId) => { send({ type: 'miniapp-ui-contextmenu-result', id: reqId, itemId }) },
        )
      } else {
        send({ type: 'miniapp-ui-contextmenu-result', id: reqId, itemId: null })
      }
      return true
    }
    case 'miniapp-popover-show':
      if (overlay?.onPopoverShow) {
        overlay.onPopoverShow(
          {
            template: data.template as string,
            data: data.data,
            anchorRect: data.anchorRect as MiniAppPopoverShowRequest['anchorRect'],
            side: data.side as MiniAppPopoverShowRequest['side'],
            align: data.align as MiniAppPopoverShowRequest['align'],
            width: data.width as number | undefined,
            maxHeight: data.maxHeight as number | undefined,
          },
          send,
        )
      }
      return true
    case 'miniapp-popover-msg':
      overlay?.onPopoverMsg?.(data.data)
      return true
    case 'miniapp-popover-close':
      overlay?.onPopoverClose?.()
      return true
    case 'miniapp-context-set': {
      const app = useMiniAppStore.getState().apps.find((a) => a.id === appId)
      useChatStore.getState().setMiniAppContext(appId, {
        appName: app?.manifest.name ?? appId,
        summary: data.summary as string,
        content: data.content as string,
        mode: data.mode === 'suggest' ? 'suggest' : 'inject',
        color: data.color as string | undefined,
      })
      return true
    }
    case 'miniapp-context-clear':
      useChatStore.getState().clearMiniAppContext(appId)
      return true
    default:
      return false
  }
}
