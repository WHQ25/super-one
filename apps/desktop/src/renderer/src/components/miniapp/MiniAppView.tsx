import { forwardRef, useRef, useImperativeHandle, useCallback, useEffect } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppOverlay } from '@/hooks/useMiniAppOverlay'
import { MiniAppWebviewPanel, type MiniAppWebviewPanelHandle } from './MiniAppWebviewPanel'
import { MiniAppOverlayPortal } from './MiniAppOverlayPortal'

export interface MiniAppViewHandle {
  reload: () => void
  openDevTools: () => void
}

interface MiniAppViewProps {
  instanceKey: string
  appId: string
  className?: string
}

export const MiniAppView = forwardRef<MiniAppViewHandle, MiniAppViewProps>(
  function MiniAppView({ instanceKey, appId, className }, ref) {
    const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
    const projectDir = useMiniAppStore((s) => s.openApps[instanceKey]?.projectDir ?? '')
    const registerDevControls = useMiniAppStore((s) => s.registerDevControls)
    const unregisterDevControls = useMiniAppStore((s) => s.unregisterDevControls)
    const templates = app?.manifest.templates
    const panelRef = useRef<MiniAppWebviewPanelHandle>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const { tooltip, contextMenu, dismissContextMenu, popover, closePopover, overlayCallbacks } = useMiniAppOverlay(containerRef, appId, projectDir, templates)

    const reload = useCallback(() => {
      panelRef.current?.reload()
    }, [])

    const openDevTools = useCallback(() => {
      panelRef.current?.openDevTools()
    }, [])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    // Every app now renders in a WebView, so reload / devtools work for
    // installed apps too — not just `isDev` ones.
    useEffect(() => {
      registerDevControls(instanceKey, { reload, openDevTools })
      return () => unregisterDevControls(instanceKey)
    }, [instanceKey, reload, openDevTools, registerDevControls, unregisterDevControls])

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <MiniAppWebviewPanel ref={panelRef} instanceKey={instanceKey} appId={appId} projectDir={projectDir} className="h-full w-full" overlay={overlayCallbacks} />
        <MiniAppOverlayPortal
          tooltip={tooltip}
          contextMenu={contextMenu}
          popover={popover}
          onDismissContextMenu={dismissContextMenu}
          onDismissPopover={closePopover}
        />
      </div>
    )
  },
)
