import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { MiniAppView } from './MiniAppView'

export function MiniAppHostLayer() {
  const openInstanceKeys = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))
  const layoutMode = useAppStore((s) => s.layoutMode)

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
        <PersistentMiniAppContainer key={instanceKey} instanceKey={instanceKey} layoutMode={layoutMode} />
      ))}
    </div>
  )
}

function PersistentMiniAppContainer({ instanceKey, layoutMode }: { instanceKey: string; layoutMode: 'canvas' | 'coding' }) {
  const slot = useMiniAppStore((s) => s.slots[instanceKey])
  const open = useMiniAppStore((s) => s.openApps[instanceKey])
  const appId = open?.entry.id
  const presentation = open?.presentation
  const presentationMatches =
    (layoutMode === 'canvas' && presentation === 'canvas') ||
    (layoutMode === 'coding' && presentation === 'panel')
  const visible = presentationMatches && slot != null && slot.width > 0 && slot.height > 0

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
