import { forwardRef, useRef, useImperativeHandle, useCallback, useEffect } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppOverlay } from '@/hooks/useMiniAppOverlay'
import { MiniAppFrame } from './MiniAppFrame'
import { MiniAppDevFrame, type MiniAppDevFrameHandle } from './MiniAppDevFrame'
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
    const isDev = app?.manifest.isDev
    const templates = app?.manifest.templates
    const devRef = useRef<MiniAppDevFrameHandle>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const { tooltip, contextMenu, dismissContextMenu, popover, closePopover, overlayCallbacks } = useMiniAppOverlay(containerRef, appId, projectDir, templates)

    const reload = useCallback(() => {
      if (isDev) devRef.current?.reload()
      else if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
    }, [isDev])

    const openDevTools = useCallback(() => {
      if (isDev) devRef.current?.openDevTools()
    }, [isDev])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    useEffect(() => {
      if (!isDev) return
      registerDevControls(instanceKey, { reload, openDevTools })
      return () => unregisterDevControls(instanceKey)
    }, [isDev, instanceKey, reload, openDevTools, registerDevControls, unregisterDevControls])

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {isDev
          ? <MiniAppDevFrame ref={devRef} instanceKey={instanceKey} appId={appId} projectDir={projectDir} className="h-full w-full" overlay={overlayCallbacks} />
          : <MiniAppFrame ref={iframeRef} instanceKey={instanceKey} appId={appId} projectDir={projectDir} className="h-full w-full" overlay={overlayCallbacks} />
        }
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
