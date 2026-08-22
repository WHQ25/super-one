import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppMediaStore } from '@/stores/miniapp-media'
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
    case 'miniapp-node-post-message':
      window.miniapp.hostPostMessage(projectDir, appId, data.payload)
      return true
    case 'miniapp-ui-start-drag':
      if (Array.isArray(data.paths)) {
        const iconOpts = data.iconPng
          ? { png: data.iconPng as ArrayBuffer, scaleFactor: (data.scaleFactor as number) ?? 1 }
          : undefined
        window.miniapp.startDrag(projectDir, appId, data.paths as string[], iconOpts)
      }
      return true
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
