import { useRef } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useIosSimulatorPipStore, type IosSimulatorSlotMode } from '@/stores/ios-simulator-pip'
import { useSlotBounds } from '@/hooks/useSlotBounds'

interface IosSimulatorViewProps {
  sessionId: string
  mode: IosSimulatorSlotMode
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
 * This is where the device APPEARS but not where it lives — `IosSimulatorHostLayer`
 * holds the one real panel per session and positions it over whichever hole is
 * winning. Both the Activity tab and the floating preview place one of these, and
 * that is the entire reason switching between them is free: neither of them owns the
 * panel, so neither of them can destroy it.
 *
 * Same shape as `BrowserView`, for the same reason, against the same problem.
 */
export function IosSimulatorView({
  sessionId,
  mode,
  className,
  trackBoundsContinuously = false,
}: IosSimulatorViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useSlotBounds(
    ref,
    `${sessionId}:${mode}`,
    (rect) => useIosSimulatorPipStore.getState().updateSlot(sessionId, mode, rect),
    () => useIosSimulatorPipStore.getState().unregisterSlot(sessionId, mode),
    trackBoundsContinuously,
  )

  return (
    <div
      ref={ref}
      data-ios-simulator-slot={mode}
      data-session-id={sessionId}
      className={cn('h-full w-full', className)}
    />
  )
}
