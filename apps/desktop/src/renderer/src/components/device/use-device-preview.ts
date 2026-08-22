import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useDevicePipStore } from '@/stores/device-pip'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'

export interface DevicePreviewState {
  /** The session whose device the preview would show, bound and ready. */
  sessionId: string | null
  /** Bound, belonging to the conversation on screen, and not dismissed. */
  deviceOnScreen: boolean
  /** ...and there is room for a floating preview at all. */
  shouldShow: boolean
  expanded: boolean
  showPip: boolean
}

/**
 * Whether the floating preview has earned the screen, and in which size.
 *
 * Read by three components that have to agree exactly — the backdrop under the
 * device, the host layer holding it, and the chrome over it. They are separate
 * because they paint in three different places, so the one thing they must not do is
 * each work the conditions out for themselves.
 */
export function useDevicePreview(): DevicePreviewState {
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  const readySessionId = useDevicePipStore((state) => state.readySessionId)
  const expandedSessionId = useDevicePipStore((state) => state.expandedSessionId)
  const hiddenSessionId = useDevicePipStore((state) => state.hiddenSessionId)
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const mosaicMode = useMosaicStore((state) => state.mode)

  const sessionId = readySessionId
  // WHICH surface the device gets is the next two lines' business — the preview when
  // there is room for it, the Activity tab otherwise.
  const deviceOnScreen = sessionId != null
    && sessionId === currentSessionId
    && sessionId !== hiddenSessionId
  const shouldShow = deviceOnScreen && !activityShown && mosaicMode === 'single'
  const expanded = shouldShow && expandedSessionId === sessionId

  return { sessionId, deviceOnScreen, shouldShow, expanded, showPip: shouldShow && !expanded }
}
