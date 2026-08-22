import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DEVICE_CAPABILITIES, isDeviceLandscape } from '@superone/shared/device'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useDevicePipStore } from '@/stores/device-pip'
import { hasDeviceTab, openDeviceTab } from '@/components/activity/activity-panel-api'
import { useDevicePreview } from './use-device-preview'

/**
 * Hand the bound device the Activity tab, unless it already has somewhere to be.
 *
 * The invariant both callers serve: a device that is bound and ready is ALWAYS on
 * some visible surface — the floating preview, or a tab. The preview and the panel
 * are mutually exclusive by design, so every moment one of them goes away is a
 * moment the other has to take over, and there are two of them: the grant can land
 * while the panel is already open, or the panel can open onto an already-bound
 * device. Only the first was wired, so opening the panel over a running simulator
 * dropped the preview and left the launcher looking like nothing was running.
 *
 * Two things it deliberately will NOT do. A dismissed preview stays dismissed:
 * hiding is about this device, not about this surface. And an existing tab is left
 * exactly where it is — the user may have opened the panel for a terminal, and
 * re-activating the simulator every time the panel is shown would fight them for it.
 */
function revealDeviceTab(sessionId: string, label: string): void {
  if (useDevicePipStore.getState().hiddenSessionId === sessionId) return
  if (hasDeviceTab(sessionId)) return
  openDeviceTab(sessionId, label)
}

/**
 * Keep `readySessionId` and the surface arbitration current. Mounted once, by the
 * host layer, which is the thing that needs the answer.
 *
 * Above any visibility test on purpose: the whole point is to notice the moment
 * `device_request_control` is approved, and a hook that only ran while the preview was
 * already showing could never see it.
 *
 * Main pushes state on change only, so a window opened onto an already-bound session
 * shows nothing until something moves. That is deliberate — the preview is a reaction
 * to a grant, not a permanent second copy of the Activity panel.
 */
export function useDeviceHandover(): void {
  const { t } = useTranslation()
  const openTabLabel = t('activity.device.title')
  const currentSessionId = useChatStore(selectActiveChatSessionId)
  const activityShown = useActivityPanelStore((state) => state.showPanel)
  const { sessionId, deviceOnScreen } = useDevicePreview()

  useEffect(() => {
    if (!currentSessionId) {
      useDevicePipStore.getState().setReady(null)
      return
    }
    return window.environment.onDeviceSessionState(currentSessionId, (state) => {
      const bound = state.phase === 'ready' ? state.device : null
      const store = useDevicePipStore.getState()
      if (!bound) {
        if (store.readySessionId === currentSessionId) store.setReady(null)
        return
      }
      // Only the transition into ready, never a republish: rotation and the hardware
      // keyboard push state through this same channel, and reacting to those would
      // yank the dock to the simulator tab every time the agent turned the device.
      const arriving = store.readySessionId !== currentSessionId
      // A republish IS how a rotation arrives, though, and the preview box is the
      // device's outline — so the shape is read every time.
      //
      // Whether the reported size already describes the turned device is the same
      // platform split the stage draws with. A simulator's framebuffer never changes
      // shape, so a device on its side is the same numbers swapped by hand; Android
      // re-shapes it and scrcpy republishes the swapped pair, so swapping again would
      // hand the preview a portrait box for a landscape phone.
      const swap = DEVICE_CAPABILITIES[bound.provider].rigidRotation && isDeviceLandscape(state.orientation)
      const width = (swap ? state.pixelHeight : state.pixelWidth) ?? 0
      const height = (swap ? state.pixelWidth : state.pixelHeight) ?? 0
      store.setReady(currentSessionId, {
        id: bound.id,
        provider: bound.provider,
        platform: bound.platform,
        width,
        height,
      })
      // The preview is suppressed while the Activity panel is up, so a grant that
      // lands then would show the user nothing at all. Give it the tab instead —
      // whichever surface is available, approving a device has to reveal one.
      if (arriving && useActivityPanelStore.getState().showPanel) {
        revealDeviceTab(currentSessionId, openTabLabel)
      }
    })
  }, [currentSessionId, openTabLabel])

  // Opening the Activity panel takes the device back to its tab; the preview exists
  // only for the case where there is nowhere else to watch it. Which means the tab
  // has to actually be there — the shrink below is what makes the preview go away,
  // so without the reveal beside it the device goes away with it.
  useEffect(() => {
    if (!activityShown) return
    useDevicePipStore.getState().shrinkPreview()
    if (deviceOnScreen && sessionId) revealDeviceTab(sessionId, openTabLabel)
  }, [activityShown, deviceOnScreen, sessionId, openTabLabel])
}
