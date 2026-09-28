import { useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'
import { selectViewfinderTarget, useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useMiniAppStore } from '@/stores/miniapp'
import { isMiniAppPipHidden, useMiniAppPipStore } from '@/stores/miniapp-pip'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { usePipPlacement } from '@/hooks/use-pip-placement'
import { PIP_RESIZE_CORNERS, usePipInteraction } from '@/hooks/use-pip-interaction'
import { MiniAppSlot } from './MiniAppSlot'
import {
  miniAppHostSlotKey,
  miniAppTargetKey,
  parseMiniAppTargetId,
  projectDirOfSession,
  showMiniAppTargetInPanel,
} from './miniapp-automation-targets'
import { MINIAPP_PIP_DIMENSIONS, miniAppPipAspect, miniAppPipViewport } from './miniapp-pip-layout'

/**
 * The development mini-app view the current session's agent is driving, while the
 * Activity panel is closed. The frame only reports its slot; the host layer draws
 * the live view there. Clicking it opens the view in the Activity panel.
 */
export function MiniAppPictureInPicture() {
  const { t } = useTranslation()
  const sessionId = useChatStore(selectActiveChatSessionId)
  const targetId = useAgentViewfinderStore((state) => {
    const target = selectViewfinderTarget(state, sessionId)
    return target?.kind === 'miniapp' ? target.targetId : null
  })
  const projectDir = useChatStore((state) => (sessionId ? projectDirOfSession(state.projectSessions, sessionId) : null))
  const openApps = useMiniAppStore((state) => state.openApps)
  const previews = useToolUiPreviewStore((state) => state.previews)
  const slotKey = targetId && projectDir ? miniAppHostSlotKey(targetId, projectDir, openApps, previews) : null
  const panelWidth = useActivityPanelStore((state) => state.panelWidth)
  const panelHeight = useActivityPanelStore((state) => state.bounds?.height)
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const mosaicMode = useMosaicStore((state) => state.mode)
  const hidden = useMiniAppPipStore((state) => isMiniAppPipHidden(state, sessionId, targetId))
  const showPip = slotKey != null && !activityShown && mosaicMode === 'single' && !hidden
  const emulation = useBrowserStore((state) => (
    targetId && projectDir && parseMiniAppTargetId(targetId).kind === 'panel'
      ? state.emulations[miniAppTargetKey(targetId, projectDir)]
      : undefined
  ))
  const aspect = miniAppPipAspect(miniAppPipViewport(panelWidth, panelHeight, emulation))

  const { bounds, layout, setLayout } = usePipPlacement({
    key: targetId,
    active: showPip,
    aspect,
    dims: MINIAPP_PIP_DIMENSIONS,
  })

  const openInPanel = useCallback(() => {
    if (targetId && projectDir) showMiniAppTargetInPanel(targetId, projectDir)
  }, [projectDir, targetId])

  const hidePreview = useCallback(() => {
    if (sessionId && targetId) useMiniAppPipStore.getState().hide(sessionId, targetId)
  }, [sessionId, targetId])

  const { interacting, onPointerDown, startResize } = usePipInteraction({
    bounds,
    layout,
    setLayout,
    aspect,
    dims: MINIAPP_PIP_DIMENSIONS,
    active: showPip,
    onClick: openInPanel,
  })

  return (
    <AnimatePresence>
      {showPip && slotKey && layout && (
        <motion.div
          key={`pip:${slotKey}`}
          data-miniapp-pip=""
          aria-label={t('chat.miniAppPreview.label')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="group/miniapp-pip pointer-events-none fixed overflow-hidden rounded-xl border border-border shadow-2xl"
          style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
        >
          <MiniAppSlot slotKey={slotKey} mode="pip" className="h-full w-full" trackBoundsContinuously={interacting} />
          <div
            data-miniapp-pip-drag-handle=""
            role="button"
            tabIndex={0}
            aria-label={t('chat.miniAppPreview.open')}
            className="pointer-events-auto absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={onPointerDown}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              openInPanel()
            }}
          />
          <div className="pointer-events-none absolute right-1 top-1 z-10 rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/miniapp-pip:pointer-events-auto group-hover/miniapp-pip:opacity-100 group-focus-within/miniapp-pip:pointer-events-auto group-focus-within/miniapp-pip:opacity-100">
            <IconButton
              aria-label={t('chat.miniAppPreview.hide')}
              tooltip={t('chat.miniAppPreview.hide')}
              tooltipSide="bottom"
              size="xs"
              variant="ghost"
              onClick={hidePreview}
            >
              <EyeOff />
            </IconButton>
          </div>
          {PIP_RESIZE_CORNERS.map(({ corner, className }) => (
            <div
              key={corner}
              data-miniapp-pip-resize={corner}
              className={cn('pointer-events-auto absolute z-20 size-4', className)}
              onPointerDown={(event) => startResize(corner, event)}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
