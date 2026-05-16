import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppMediaStore } from '@/stores/miniapp-media'
import { requestOpenExternalLink } from '@/lib/external-link'
import { requestClipboardRead, requestClipboardWrite } from '@/lib/miniapp-clipboard'
import { toast } from 'sonner'
import { MINIAPP_HEADLESS_SAFE_TYPES, MINIAPP_WORKER_REJECT_RESPONSE, MINIAPP_WORKER_UNAVAILABLE_ERROR } from '@superone/shared/miniapp-types'
import type { MiniAppMediaKind, MiniAppTooltipRequest, MiniAppContextMenuRequest, MiniAppPopoverShowRequest } from '@superone/shared/miniapp-types'

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
  projectDir: string,
  send: (msg: unknown) => void,
  overlay?: MiniAppOverlayCallbacks,
): boolean {
  switch (type) {
    case 'miniapp-tool-result':
      window.app.trace?.('miniapp.tool', 'iframe_reply', { appId, hasError: !!data.error }, data.callId as string)
      window.miniapp.toolResult(data.callId as string, data.result, data.error as string | undefined)
      return true
    case 'miniapp-sendPrompt':
      if (typeof data.text === 'string') {
        useChatStore.getState().setDraftText(data.text)
      }
      return true
    case 'miniapp-fs-request':
      window.miniapp
        .fsRequest(projectDir, (data.appId as string) ?? appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-fs-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-fs-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-git-request':
      window.miniapp
        .gitRequest(projectDir, appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-git-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-git-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-db-request':
      window.miniapp
        .dbRequest(appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-db-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-db-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-kv-request':
      window.miniapp
        .kvRequest(appId, data.op as string, data.args as Record<string, unknown>)
        .then((result) => { send({ type: 'miniapp-kv-response', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-kv-response', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-peer-emit':
      if (typeof data.event === 'string') {
        window.miniapp.peerEmit(appId, data.event, data.payload)
      }
      return true
    case 'miniapp-worker-start':
      window.miniapp
        .workerStart(projectDir, appId)
        .then((result) => { send({ type: 'miniapp-worker-status-result', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-worker-status-result', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-worker-stop':
      window.miniapp
        .workerStop(projectDir, appId)
        .then((result) => { send({ type: 'miniapp-worker-status-result', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-worker-status-result', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-worker-status':
      window.miniapp
        .workerStatus(projectDir, appId)
        .then((result) => { send({ type: 'miniapp-worker-status-result', id: data.id, result }) })
        .catch((err: unknown) => { send({ type: 'miniapp-worker-status-result', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-worker-msg':
      window.miniapp.workerSend(projectDir, appId, (data as { payload?: unknown }).payload)
      return true
    case 'miniapp-fs-watch':
      window.miniapp
        .fsWatch(projectDir, appId, data.path as string)
        .then((watchId) => { send({ type: 'miniapp-fs-watch-ack', id: data.id, watchId }) })
        .catch((err: unknown) => { send({ type: 'miniapp-fs-watch-ack', id: data.id, error: (err as Error).message }) })
      return true
    case 'miniapp-fs-unwatch':
      window.miniapp.fsUnwatch(data.watchId as number)
      return true
    case 'miniapp-open-folder':
      if (typeof data.path === 'string') {
        window.miniapp.fsRequest(projectDir, appId, 'showInFolder', { path: data.path })
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
    case 'miniapp-media-started': {
      const kinds = (data.kinds as string[] | undefined)?.filter((k): k is MiniAppMediaKind => k === 'microphone' || k === 'camera') ?? []
      if (kinds.length > 0) useMiniAppMediaStore.getState().start(appId, kinds)
      return true
    }
    case 'miniapp-media-track-ended': {
      const kind = data.kind as string
      if (kind === 'microphone' || kind === 'camera') {
        useMiniAppMediaStore.getState().endTrack(appId, kind)
      }
      return true
    }
    default:
      return false
  }
}

export function handleMiniAppWorkerMessage(
  type: string,
  data: Record<string, unknown>,
  appId: string,
  projectDir: string,
  send: (msg: unknown) => void,
): boolean {
  if (MINIAPP_HEADLESS_SAFE_TYPES.has(type)) {
    return handleMiniAppMessage(type, data, appId, projectDir, send)
  }
  const responseType = MINIAPP_WORKER_REJECT_RESPONSE[type]
  if (responseType) {
    send({ type: responseType, id: data.id, error: MINIAPP_WORKER_UNAVAILABLE_ERROR })
    return true
  }
  if (type.startsWith('miniapp-')) return true
  return false
}
