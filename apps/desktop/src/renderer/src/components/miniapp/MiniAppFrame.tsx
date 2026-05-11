import { useRef, forwardRef, useImperativeHandle, useMemo } from 'react'
import { useMiniAppBridge } from '@/hooks/useMiniAppBridge'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppOverlayCallbacks } from '@/hooks/miniapp-message-handler'
import { buildMiniAppFrameAttrs } from '@superone/shared/miniapp-frame-attrs'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'

interface MiniAppFrameProps {
  instanceKey: string
  appId: string
  projectDir: string
  className?: string
  overlay?: MiniAppOverlayCallbacks
}

export const MiniAppFrame = forwardRef<HTMLIFrameElement, MiniAppFrameProps>(
  function MiniAppFrame({ instanceKey, appId, projectDir, className, overlay }, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useImperativeHandle(ref, () => iframeRef.current!, [])

  useMiniAppBridge({ appId, projectDir, iframeRef, overlay })

  const mediaEntries = useMiniAppStore((s) => s.apps.find((a) => a.id === appId)?.manifest.permissions?.media)
  const { sandbox, allow } = useMemo(() => buildMiniAppFrameAttrs(mediaEntries?.map((m) => m.kind)), [mediaEntries])

  const projectId = useMiniAppStore((s) => s.openApps[instanceKey]?.projectId ?? null)
  const src = `superone-app://${buildMiniAppHost(appId, projectId)}/index.html`

  return (
    <div className={className} style={{ position: 'relative', minWidth: 0 }}>
      <iframe
        ref={iframeRef}
        src={src}
        sandbox={sandbox}
        allow={allow}
        style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
      />
    </div>
  )
})
