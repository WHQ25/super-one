import { forwardRef, useRef, useImperativeHandle, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, Bug } from 'lucide-react'
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
  appId: string
  className?: string
}

export const MiniAppView = forwardRef<MiniAppViewHandle, MiniAppViewProps>(
  function MiniAppView({ appId, className }, ref) {
    const { t } = useTranslation()
    const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
    const isFullscreenActive = useMiniAppStore((s) => s.fullscreenApp?.appId === appId)
    const isDev = app?.manifest.isDev
    const templates = app?.manifest.templates
    const devRef = useRef<MiniAppDevFrameHandle>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const { tooltip, contextMenu, dismissContextMenu, popover, closePopover, overlayCallbacks } = useMiniAppOverlay(containerRef, appId, templates)

    const reload = useCallback(() => {
      if (isDev) devRef.current?.reload()
      else if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
    }, [isDev])

    const openDevTools = useCallback(() => {
      if (isDev) devRef.current?.openDevTools()
    }, [isDev])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    useEffect(() => {
      if (!isFullscreenActive) return
      const handleKeyDown = (e: KeyboardEvent) => {
        const isMod = e.metaKey || e.ctrlKey
        if (isMod && e.key === 'r') {
          e.preventDefault()
          e.stopPropagation()
          reload()
        }
        if (isMod && e.shiftKey && e.key === 'i') {
          e.preventDefault()
          e.stopPropagation()
          openDevTools()
        }
      }
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [isFullscreenActive, reload, openDevTools])

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {isDev && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-0.5 rounded-md bg-black/60 p-0.5 backdrop-blur-sm">
            <button
              onClick={reload}
              className="rounded p-1 text-white/70 hover:text-white"
              title={t('tooltips.reload')}
            >
              <RotateCw className="size-3.5" />
            </button>
            <button
              onClick={openDevTools}
              className="rounded p-1 text-white/70 hover:text-white"
              title={t('tooltips.devTools')}
            >
              <Bug className="size-3.5" />
            </button>
          </div>
        )}
        {isDev
          ? <MiniAppDevFrame ref={devRef} appId={appId} className="h-full w-full" overlay={overlayCallbacks} />
          : <MiniAppFrame ref={iframeRef} appId={appId} className="h-full w-full" overlay={overlayCallbacks} />
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
