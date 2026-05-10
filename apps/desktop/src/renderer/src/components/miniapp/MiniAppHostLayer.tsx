import { useMiniAppStore } from '@/stores/miniapp'
import { useShallow } from 'zustand/react/shallow'
import { MiniAppView } from './MiniAppView'

export function MiniAppHostLayer() {
  const openAppIds = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))

  return (
    <div
      data-miniapp-host-layer=""
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {openAppIds.map((appId) => (
        <PersistentMiniAppContainer key={appId} appId={appId} />
      ))}
    </div>
  )
}

function PersistentMiniAppContainer({ appId }: { appId: string }) {
  const slot = useMiniAppStore((s) => s.slots[appId])
  const visible = slot != null && slot.width > 0 && slot.height > 0

  return (
    <div
      data-miniapp-host=""
      data-app-id={appId}
      style={{
        position: 'absolute',
        left: slot?.left ?? 0,
        top: slot?.top ?? 0,
        width: slot?.width ?? 0,
        height: slot?.height ?? 0,
        display: visible ? 'block' : 'none',
        pointerEvents: visible ? 'auto' : 'none',
        overflow: 'hidden',
      }}
    >
      <MiniAppView appId={appId} className="h-full w-full" />
    </div>
  )
}
