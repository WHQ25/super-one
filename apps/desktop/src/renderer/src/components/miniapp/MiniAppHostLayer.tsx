import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft, PanelRight, PanelTop, PanelBottom, SquarePlus } from 'lucide-react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { toolUiPreviewSlotKey, useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { useBrowserStore } from '@/stores/browser'
import { miniAppPanelTargetId, miniAppPreviewTargetId } from '@superone/shared/miniapp-automation-target'
import { useActivityDropStore, type DropPosition } from '@/stores/activity-drop'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { panelCornersForSlot } from '@/components/activity/activity-panel-corners'
import { useActivityPanelOnScreen } from '@/hooks/useActivityPanelOnScreen'
import { useAppStore } from '@/stores/app'
import { useSashResizing } from '@/hooks/useSashResizing'
import { useGlobalDragging } from '@/hooks/useGlobalDragging'
import { useFullscreen } from '@/hooks/useFullscreen'
import { Z } from '@/lib/z-layers'
import { useShallow } from 'zustand/react/shallow'
import { MiniAppView } from './MiniAppView'
import { MiniAppToolPreviewPanel } from './MiniAppToolPreviewPanel'
import { MiniAppPictureInPicture } from './MiniAppPictureInPicture'
import { miniAppPipViewport } from './miniapp-pip-layout'
import { miniAppTargetKey } from './miniapp-automation-targets'

const DROP_GUIDE_ICON: Record<DropPosition, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  top: PanelTop,
  bottom: PanelBottom,
  center: SquarePlus,
}

function DropGuide({ position }: { position: DropPosition }) {
  const { t } = useTranslation()
  const Icon = DROP_GUIDE_ICON[position]
  return (
    <div className="flex flex-col items-center gap-1.5 text-primary">
      <Icon className="size-5 shrink-0" />
      <span className="text-xs font-medium">{t(`resources.apps.dropHint.${position}`)}</span>
    </div>
  )
}

export function MiniAppHostLayer() {
  const openInstanceKeys = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))
  const previewKeys = useToolUiPreviewStore(useShallow((s) => Object.keys(s.previews)))
  const globalDragging = useGlobalDragging()
  const sashResizing = useSashResizing()
  const dragging = globalDragging || sashResizing
  const indicator = useActivityDropStore((s) => s.indicator)

  useEffect(() => {
    if (!dragging) useActivityDropStore.getState().setIndicator(null)
  }, [dragging])

  return (
    <div
      data-miniapp-host-layer=""
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: Z.HOST_MINIAPP,
      }}
    >
      {openInstanceKeys.map((instanceKey) => (
        <PersistentMiniAppContainer key={instanceKey} instanceKey={instanceKey} dragging={dragging} />
      ))}
      {previewKeys.map((previewKey) => (
        <PersistentToolUiPreview key={previewKey} previewKey={previewKey} dragging={dragging} />
      ))}
      <MiniAppPictureInPicture />
      {dragging && indicator && (
        <div
          data-activity-drop-indicator=""
          className="activity-drop-indicator"
          style={{
            position: 'absolute',
            left: indicator.left,
            top: indicator.top,
            width: indicator.width,
            height: indicator.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={indicator.width} height={indicator.height}>
            <rect x={1} y={1} width={indicator.width - 2} height={indicator.height - 2} rx={10} ry={10} />
          </svg>
          <DropGuide position={indicator.position} />
        </div>
      )}
    </div>
  )
}

function PersistentMiniAppContainer({ instanceKey, dragging }: { instanceKey: string; dragging: boolean }) {
  const appId = useMiniAppStore((s) => s.openApps[instanceKey]?.entry.id)
  const projectDir = useMiniAppStore((s) => s.openApps[instanceKey]?.projectDir)
  if (!appId || !projectDir) return null
  return (
    <HostedMiniAppView
      slotKey={instanceKey}
      captureKey={miniAppTargetKey(miniAppPanelTargetId(appId), projectDir)}
      emulated
      dragging={dragging}
      attributes={{ 'data-instance-key': instanceKey, 'data-app-id': appId }}
    >
      <MiniAppView instanceKey={instanceKey} appId={appId} className="h-full w-full" />
    </HostedMiniAppView>
  )
}

function PersistentToolUiPreview({ previewKey, dragging }: { previewKey: string; dragging: boolean }) {
  const appId = useToolUiPreviewStore((s) => s.previews[previewKey]?.appId)
  const projectDir = useToolUiPreviewStore((s) => s.previews[previewKey]?.projectDir)
  if (!appId || !projectDir) return null
  return (
    <HostedMiniAppView
      slotKey={toolUiPreviewSlotKey(previewKey)}
      captureKey={miniAppTargetKey(miniAppPreviewTargetId(appId), projectDir)}
      dragging={dragging}
      attributes={{ 'data-tool-ui-preview-key': previewKey }}
    >
      <MiniAppToolPreviewPanel previewKey={previewKey} />
    </HostedMiniAppView>
  )
}

/**
 * One persistent mini-app view, drawn over its dock slot or, while an agent drives
 * it with the Activity panel closed, over the picture-in-picture frame. The element
 * tree never changes between the two, so the WebView guest survives the move.
 */
function HostedMiniAppView({ slotKey, captureKey, emulated = false, dragging, attributes, children }: {
  slotKey: string
  /** The view's WebView registry key, which screenshots hold full-resolution captures on. */
  captureKey: string
  /** The whole view is one WebView, so an emulated viewport is also its preview size. */
  emulated?: boolean
  dragging: boolean
  attributes: Record<string, string>
  children: React.ReactNode
}) {
  const panelSlot = useMiniAppStore((s) => s.slots[slotKey])
  const pipSlot = useMiniAppPipStore((s) => s.pipSlots[slotKey])
  const panelWidth = useActivityPanelStore((s) => s.panelWidth)
  const panelHeight = useActivityPanelStore((s) => s.bounds?.height)
  const activitySide = useActivityPanelStore((s) => s.side)
  const activityShown = useActivityPanelOnScreen()
  const inPip = pipSlot != null && pipSlot.width > 0 && pipSlot.height > 0
  const panelMounted = panelSlot != null && panelSlot.width > 0 && panelSlot.height > 0
  const slot = inPip ? pipSlot : panelSlot
  const visible = inPip || (panelMounted && activityShown)
  // The view keeps its panel layout inside the preview and is scaled to fit.
  const emulation = useBrowserStore((s) => (emulated ? s.emulations[captureKey] : undefined))
  const viewport = miniAppPipViewport(panelWidth, panelHeight, emulation)
  // A scaled guest rasterizes at the scaled size, so a screenshot briefly lays it
  // out unscaled, invisibly, as the browser preview does.
  const capturing = useBrowserStore((s) => (s.fullResolutionCaptureRefs[captureKey] ?? 0) > 0)
  const capturingPip = inPip && capturing
  // Match the main card corners: fullscreen drops outer radii that sit on the
  // screen edge (right always; left when the sidebar is collapsed).
  const isFullscreen = useFullscreen()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const roundLeft = !isFullscreen || showSidebar
  const roundRight = !isFullscreen
  // Only the group actually sitting in the corner; every other group's bottom
  // edge runs into a sash, where a radius reads as a notch.
  const panelBounds = useActivityPanelStore((s) => s.bounds)
  const panelCorners = panelCornersForSlot(panelSlot, panelBounds)

  return (
    <div
      data-miniapp-host=""
      data-miniapp-presentation={inPip ? 'pip' : 'panel'}
      {...attributes}
      style={{
        position: 'absolute',
        left: capturingPip ? 0 : visible ? (slot?.left ?? 0) : -99999,
        top: capturingPip ? 0 : (slot?.top ?? 0),
        width: capturingPip ? viewport.width : (slot?.width ?? 0),
        height: capturingPip ? viewport.height : (slot?.height ?? 0),
        opacity: capturingPip ? 0 : undefined,
        display: inPip || panelMounted ? 'block' : 'none',
        pointerEvents: visible && !inPip && !dragging ? 'auto' : 'none',
        overflow: 'hidden',
        // Longhands only: React cannot diff a shorthand against its own longhands.
        borderTopLeftRadius: inPip ? 'var(--radius-xl)' : undefined,
        borderTopRightRadius: inPip ? 'var(--radius-xl)' : undefined,
        borderBottomLeftRadius: inPip || (roundLeft && activitySide === 'left' && panelCorners.bottomLeft) ? 'var(--radius-xl)' : undefined,
        borderBottomRightRadius: inPip || (roundRight && activitySide === 'right' && panelCorners.bottomRight) ? 'var(--radius-xl)' : undefined,
      }}
    >
      <div
        style={inPip && !capturingPip
          ? { width: viewport.width, height: viewport.height, transform: `scale(${pipSlot.width / viewport.width})`, transformOrigin: 'left top' }
          : { width: '100%', height: '100%' }}
      >
        {children}
      </div>
    </div>
  )
}
