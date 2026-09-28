import { useRef } from 'react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { useSlotBounds } from '@/hooks/useSlotBounds'

interface MiniAppSlotProps {
  /** An app instance key, or a tool UI preview's slot key. */
  slotKey: string
  mode: 'panel' | 'pip'
  className?: string
  trackBoundsContinuously?: boolean
}

/** Reports where the host layer draws a mini-app view; renders nothing itself. */
export function MiniAppSlot({ slotKey, mode, className, trackBoundsContinuously = false }: MiniAppSlotProps) {
  const ref = useRef<HTMLDivElement>(null)

  useSlotBounds(
    ref,
    `${slotKey}:${mode}`,
    (rect) => {
      if (mode === 'pip') useMiniAppPipStore.getState().updatePipSlot(slotKey, rect)
      else useMiniAppStore.getState().updateSlot(slotKey, mode, rect)
    },
    () => {
      if (mode === 'pip') useMiniAppPipStore.getState().unregisterPipSlot(slotKey)
      else useMiniAppStore.getState().unregisterSlot(slotKey, mode)
    },
    trackBoundsContinuously,
  )

  return <div ref={ref} className={className} />
}
