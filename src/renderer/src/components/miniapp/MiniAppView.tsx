import { forwardRef, useRef, useImperativeHandle } from 'react'
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

    useImperativeHandle(ref, () => ({
      reload: () => {
        if (isDev) devRef.current?.reload()
        else if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
      },
      openDevTools: () => {
        if (isDev) devRef.current?.openDevTools()
      },
    }), [isDev])

    if (isDev) return <MiniAppDevFrame ref={devRef} appId={appId} className={className} />
    return <MiniAppFrame ref={iframeRef} appId={appId} className={className} />
  },
)
