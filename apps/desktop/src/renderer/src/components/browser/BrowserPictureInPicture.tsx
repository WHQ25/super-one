import { useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EyeOff, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActivityPanelStore } from '@/stores/activity-panel'
import {
  selectViewfinderTarget,
  useAgentViewfinderStore,
} from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useOnTurnCompleted } from '@/hooks/useOnTurnCompleted'
import { getDockApi } from '@/components/activity/activity-panel-api'
import { BrowserView } from './BrowserView'
import { usePipPlacement } from '@/hooks/use-pip-placement'
import { PIP_RESIZE_CORNERS, usePipInteraction } from '@/hooks/use-pip-interaction'
import {
  BROWSER_PIP_DIMENSIONS,
  browserPipAspect,
  resolveBrowserPipViewport,
} from './browser-pip-layout'

const OVERLAY_BACKDROP_PANES: Array<{ key: string; style: React.CSSProperties }> = [
  { key: 'top', style: { left: 0, top: 0, width: '100vw', height: '5vh' } },
  { key: 'bottom', style: { left: 0, bottom: 0, width: '100vw', height: '5vh' } },
  { key: 'left', style: { left: 0, top: '5vh', width: '5vw', height: '90vh' } },
  { key: 'right', style: { right: 0, top: '5vh', width: '5vw', height: '90vh' } },
]

export function BrowserPictureInPicture() {
  const { t } = useTranslation()
  const expandedBrowserId = useBrowserStore((state) => state.expandedBrowserId)
  const pinnedPipBrowserId = useBrowserStore((state) => state.pinnedPipBrowserId)
  const hiddenPreviewBrowserId = useBrowserStore((state) => state.hiddenPreviewBrowserId)
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  const activeTarget = useAgentViewfinderStore((state) => (
    selectViewfinderTarget(state, currentSessionId)
  ))
  const operatedBrowserId = activeTarget?.kind === 'browser' ? activeTarget.targetId : null
  const operatedBrowserReady = useBrowserStore((state) => (
    operatedBrowserId ? state.automationPreviewReady?.[operatedBrowserId] === true : false
  ))
  const automaticPreviewId = operatedBrowserId && operatedBrowserReady
    ? operatedBrowserId
    : null
  const visibleAutomaticPreviewId = automaticPreviewId !== hiddenPreviewBrowserId
    ? automaticPreviewId
    : null
  // Agent recency outranks a manually expanded older tab. Otherwise a tool switching
  // A -> B would keep drawing A merely because A happened to be expanded.
  const browserId = visibleAutomaticPreviewId ?? expandedBrowserId ?? pinnedPipBrowserId
  const expanded = browserId != null && expandedBrowserId === browserId
  const owner = useBrowserStore((state) => browserId ? state.tabs[browserId]?.owner ?? null : null)
  const emulation = useBrowserStore((state) => browserId ? state.emulations[browserId] : undefined)
  const pipAspect = browserPipAspect(resolveBrowserPipViewport(emulation, window.screen, window.app.platform))
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const mosaicMode = useMosaicStore((state) => state.mode)
  const wanted = browserId != null
    && currentSessionId != null
    && owner === currentSessionId
    && !activityShown
    && mosaicMode === 'single'
  const owns = activeTarget?.kind === 'browser'
    && activeTarget.targetId != null
    && activeTarget.targetId === browserId
  const shouldShow = wanted && owns
  const showPip = shouldShow && !expanded

  // The tab is the preview's identity: switching sessions parks this tab's position
  // and restores the incoming tab's, instead of handing it these coordinates.
  const { bounds, layout, setLayout } = usePipPlacement({
    key: browserId,
    active: showPip,
    aspect: pipAspect,
    dims: BROWSER_PIP_DIMENSIONS,
  })
  useOnTurnCompleted(() => useBrowserStore.getState().clearAutomationPreview(currentSessionId ?? undefined))

  useEffect(() => {
    if (!activityShown || !browserId) return
    // A tab opener that revealed the panel has already activated its own tab; the
    // handoff runs after it commits, so activating here would bury, say, the file
    // a chip was clicked for under the browser the agent is driving.
    if (!useActivityPanelStore.getState().revealedForTab) {
      getDockApi()?.panels.find((panel) => panel.id === browserId)?.api.setActive()
    }
    useBrowserStore.getState().clearManualPreview()
  }, [activityShown, browserId])

  useEffect(() => {
    const manualPreviewId = expandedBrowserId ?? pinnedPipBrowserId
    if (!manualPreviewId) return
    if (owner !== currentSessionId || mosaicMode !== 'single') {
      useBrowserStore.getState().clearManualPreview()
    }
  }, [currentSessionId, expandedBrowserId, mosaicMode, owner, pinnedPipBrowserId])

  const hidePreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().hidePreview(browserId)
  }, [browserId])

  const expandPreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().expandPreview(browserId)
  }, [browserId])

  const shrinkPreview = useCallback(() => {
    if (browserId) useBrowserStore.getState().shrinkPreview(browserId)
  }, [browserId])

  const { interacting, onPointerDown: onPreviewPointerDown, startResize } = usePipInteraction({
    bounds,
    layout,
    setLayout,
    aspect: pipAspect,
    dims: BROWSER_PIP_DIMENSIONS,
    active: showPip,
    onClick: expandPreview,
  })

  return (
    <AnimatePresence>
      {showPip && browserId && layout && (
        <motion.div
          key={`pip:${browserId}`}
          data-browser-pip=""
          aria-label={t('chat.browser.previewLabel')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="group/browser-pip pointer-events-none fixed overflow-hidden rounded-xl border border-border shadow-2xl"
          style={{
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
          }}
        >
          <div className="h-full">
            <BrowserView
              browserId={browserId}
              mode="pip"
              className="pointer-events-none"
              interactive={false}
              showChrome={false}
              trackBoundsContinuously={interacting}
            />
          </div>
          <div
            data-browser-pip-drag-handle=""
            role="button"
            tabIndex={0}
            aria-label={t('chat.browser.previewExpand')}
            className="pointer-events-auto absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={onPreviewPointerDown}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              expandPreview()
            }}
          />
          <div
            data-browser-pip-actions=""
            className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/browser-pip:pointer-events-auto group-hover/browser-pip:opacity-100 group-focus-within/browser-pip:pointer-events-auto group-focus-within/browser-pip:opacity-100"
          >
            <IconButton
              aria-label={t('chat.browser.previewHide')}
              tooltip={t('chat.browser.previewHide')}
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
              data-browser-pip-resize={corner}
              className={cn('pointer-events-auto absolute z-20 size-4', className)}
              onPointerDown={(event) => startResize(corner, event)}
            />
          ))}
        </motion.div>
      )}
      {shouldShow && expanded && browserId && (
        <motion.div
          key={`overlay:${browserId}`}
          data-browser-preview-overlay=""
          role="dialog"
          aria-modal="true"
          aria-labelledby="expanded-browser-preview-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-none fixed overflow-hidden rounded-none border border-border shadow-2xl"
          style={{ left: '5vw', top: '5vh', width: '90vw', height: '90vh' }}
        >
          <h2 id="expanded-browser-preview-title" className="sr-only">
            {t('chat.browser.previewExpandedLabel')}
          </h2>
          <div className="h-full">
            <BrowserView
              browserId={browserId}
              mode="overlay"
              className="pointer-events-none"
              interactive
              showChrome={false}
            />
          </div>
          <div
            data-browser-preview-actions=""
            className="pointer-events-auto absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-background/70 p-0.5 shadow-sm backdrop-blur-sm"
          >
            <IconButton
              aria-label={t('chat.browser.previewShrink')}
              tooltip={t('chat.browser.previewShrink')}
              tooltipSide="bottom"
              size="sm"
              variant="ghost"
              onClick={shrinkPreview}
            >
              <Minimize2 />
            </IconButton>
            <IconButton
              aria-label={t('chat.browser.previewHide')}
              tooltip={t('chat.browser.previewHide')}
              tooltipSide="bottom"
              size="sm"
              variant="ghost"
              onClick={hidePreview}
            >
              <EyeOff />
            </IconButton>
          </div>
        </motion.div>
      )}
      {shouldShow && expanded && OVERLAY_BACKDROP_PANES.map((pane) => (
        <motion.div
          key={`overlay-backdrop:${pane.key}`}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-auto fixed bg-background/80 backdrop-blur-sm"
          style={pane.style}
        />
      ))}
    </AnimatePresence>
  )
}
