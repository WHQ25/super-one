import { useRef } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useDevicePipStore, type DeviceSlotMode } from '@/stores/device-pip'
import { useSlotBounds } from '@/hooks/useSlotBounds'

interface DeviceViewProps {
  instanceId: string
  mode: DeviceSlotMode
  className?: string
  /**
   * Re-measure every frame rather than settling. For a box the user is dragging or
   * resizing: the rect changes continuously and the device has to keep up with it,
   * where at rest two identical frames are enough to stop looking.
   */
  trackBoundsContinuously?: boolean
}

/**
 * A hole the size of the simulator, which draws nothing.
 *
 * This is where the device APPEARS but not where it lives — `DeviceHostLayer`
 * holds the one real panel per instance and positions it over whichever hole is
 * winning. Both the Activity tab and the floating preview place one of these, and
 * that is the entire reason switching between them is free: neither of them owns the
 * panel, so neither of them can destroy it.
 *
 * Same shape as `BrowserView`, for the same reason, against the same problem.
 */
export function DeviceView({
  instanceId,
  mode,
  className,
  trackBoundsContinuously = false,
}: DeviceViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useSlotBounds(
    ref,
    `${instanceId}:${mode}`,
    (rect) => useDevicePipStore.getState().updateSlot(instanceId, mode, rect),
    () => useDevicePipStore.getState().unregisterSlot(instanceId, mode),
    trackBoundsContinuously,
  )

  return (
    <div
      ref={ref}
      data-device-slot={mode}
      data-instance-id={instanceId}
      className={cn('h-full w-full', className)}
    />
  )
}
