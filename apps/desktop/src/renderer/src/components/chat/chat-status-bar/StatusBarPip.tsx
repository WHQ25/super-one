import { useState } from 'react'
import { PictureInPicture2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { selectViewfinderTarget, useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { useDeviceInstanceStore } from '@/stores/device-instances'
import { useDevicePipStore } from '@/stores/device-pip'

export type HiddenPipTarget =
  | { kind: 'browser'; sessionId: string; browserId: string }
  | { kind: 'computer'; sessionId: string; windowId: number }
  | { kind: 'device'; sessionId: string; instanceId: string; deviceId: string }

export function useHiddenPipTarget(sessionId: string | null): HiddenPipTarget | null {
  const activeTarget = useAgentViewfinderStore((state) => selectViewfinderTarget(state, sessionId))
  const hiddenBrowserId = useBrowserStore((state) => state.hiddenPreviewBrowserId)
  const hiddenBrowserOwner = useBrowserStore((state) => (
    hiddenBrowserId ? state.tabs[hiddenBrowserId]?.owner ?? null : null
  ))
  const hiddenComputerTarget = useComputerViewfinderStore((state) => (
    sessionId && state.hiddenSessions[sessionId]
      ? state.targets[sessionId] ?? null
      : null
  ))
  const hiddenDeviceInstanceId = useDevicePipStore((state) => state.hiddenInstanceId)
  const hiddenDevice = useDevicePipStore((state) => (
    hiddenDeviceInstanceId ? state.readyDevices[hiddenDeviceInstanceId] ?? null : null
  ))
  const hiddenDeviceOwner = useDeviceInstanceStore((state) => (
    hiddenDeviceInstanceId ? state.byId[hiddenDeviceInstanceId]?.sessionId ?? null : null
  ))

  if (!sessionId || !activeTarget) return null
  if (activeTarget.kind === 'computer'
    && hiddenComputerTarget?.windowId != null
    && (activeTarget.targetId == null || activeTarget.targetId === String(hiddenComputerTarget.windowId))) {
    return { kind: 'computer', sessionId, windowId: hiddenComputerTarget.windowId }
  }
  if (activeTarget.kind === 'browser'
    && hiddenBrowserId
    && hiddenBrowserOwner === sessionId
    && (activeTarget.targetId == null || activeTarget.targetId === hiddenBrowserId)) {
    return { kind: 'browser', sessionId, browserId: hiddenBrowserId }
  }
  if (activeTarget.kind === 'device'
    && hiddenDeviceInstanceId
    && hiddenDeviceOwner === sessionId
    && hiddenDevice
    && (activeTarget.targetId == null || activeTarget.targetId === hiddenDevice.id)) {
    return {
      kind: 'device',
      sessionId,
      instanceId: hiddenDeviceInstanceId,
      deviceId: hiddenDevice.id,
    }
  }
  return null
}

export function StatusBarPip({ target }: { target: HiddenPipTarget }) {
  const { t } = useTranslation()
  const [restoring, setRestoring] = useState(false)

  const restore = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      if (target.kind === 'computer') {
        const restored = await window.app.restoreComputerUseViewfinder(target.sessionId)
        if (!restored) throw new Error('Computer Use viewfinder restore was rejected')
        useComputerViewfinderStore.getState().show(target.sessionId)
        useAgentViewfinderStore.getState().activate(
          target.sessionId,
          'computer',
          String(target.windowId),
        )
      } else if (target.kind === 'browser') {
        useBrowserStore.getState().restorePreview(target.browserId)
        useAgentViewfinderStore.getState().activate(target.sessionId, 'browser', target.browserId)
      } else {
        useDevicePipStore.getState().restorePreview(target.instanceId)
        useDevicePipStore.getState().activateReady(target.instanceId)
        useAgentViewfinderStore.getState().activate(target.sessionId, 'device', target.deviceId)
      }
    } catch {
      toast.error(t('chat.pictureInPicture.restoreFailed'))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <IconButton
      variant="ghost"
      size="xs"
      tooltip={t('chat.pictureInPicture.restore')}
      disabled={restoring}
      aria-busy={restoring}
      onClick={() => void restore()}
    >
      <PictureInPicture2 data-icon="inline-start" />
    </IconButton>
  )
}
