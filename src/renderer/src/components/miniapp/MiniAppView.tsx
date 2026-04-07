import { forwardRef, useRef, useImperativeHandle, useCallback } from 'react'
import { RotateCw, Bug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppFrame } from './MiniAppFrame'
import { MiniAppDevFrame, type MiniAppDevFrameHandle } from './MiniAppDevFrame'

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
    const isDev = useMiniAppStore((s) => s.apps.find((a) => a.id === appId)?.manifest.isDev)
    const devRef = useRef<MiniAppDevFrameHandle>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    const reload = useCallback(() => {
      if (isDev) devRef.current?.reload()
      else if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
    }, [isDev])

    const openDevTools = useCallback(() => {
      if (isDev) devRef.current?.openDevTools()
    }, [isDev])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    return (
      <div className={cn('relative', className)}>
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-0.5 rounded-md bg-black/60 p-0.5 backdrop-blur-sm">
          <button
            onClick={reload}
            className="rounded p-1 text-white/70 hover:text-white"
            title="Reload"
          >
            <RotateCw className="size-3.5" />
          </button>
          {isDev && (
            <button
              onClick={openDevTools}
              className="rounded p-1 text-white/70 hover:text-white"
              title="DevTools"
            >
              <Bug className="size-3.5" />
            </button>
          )}
        </div>
        {isDev
          ? <MiniAppDevFrame ref={devRef} appId={appId} className="h-full w-full" />
          : <MiniAppFrame ref={iframeRef} appId={appId} className="h-full w-full" />
        }
      </div>
    )
  },
)
