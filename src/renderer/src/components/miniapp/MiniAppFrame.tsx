import { useRef, forwardRef, useImperativeHandle } from 'react'
import { useMiniAppBridge } from '@/hooks/useMiniAppBridge'

interface MiniAppFrameProps {
  appId: string
  className?: string
}

export const MiniAppFrame = forwardRef<HTMLIFrameElement, MiniAppFrameProps>(
  function MiniAppFrame({ appId, className }, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useImperativeHandle(ref, () => iframeRef.current!, [])

  useMiniAppBridge({ appId, iframeRef })

  return (
    <div className={className} style={{ position: 'relative', minWidth: 0 }}>
      <iframe
        ref={iframeRef}
        src={`superone-app://${appId}/index.html`}
        sandbox="allow-scripts"
        style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
      />
    </div>
  )
})
