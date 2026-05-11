import { useMiniAppStore } from '@/stores/miniapp'
import { useShallow } from 'zustand/react/shallow'
import { MiniAppView } from './MiniAppView'

export function MiniAppHostLayer() {
  const openInstanceKeys = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))

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
      {openInstanceKeys.map((instanceKey) => (
        <PersistentMiniAppContainer key={instanceKey} instanceKey={instanceKey} />
      ))}
    </div>
  )
}

function PersistentMiniAppContainer({ instanceKey }: { instanceKey: string }) {
  const slot = useMiniAppStore((s) => s.slots[instanceKey])
  const appId = useMiniAppStore((s) => s.openApps[instanceKey]?.entry.id)
  const visible = slot != null && slot.width > 0 && slot.height > 0

  if (!appId) return null

  return (
    <div
      data-miniapp-host=""
      data-instance-key={instanceKey}
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
      <MiniAppView instanceKey={instanceKey} appId={appId} className="h-full w-full" />
    </div>
  )
}
