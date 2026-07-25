import { useRef } from 'react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useSlotBounds } from '@/hooks/useSlotBounds'

interface MiniAppSlotProps {
  instanceKey: string
  mode: 'panel' | 'canvas'
  className?: string
}

export function MiniAppSlot({ instanceKey, mode, className }: MiniAppSlotProps) {
  const ref = useRef<HTMLDivElement>(null)

  useSlotBounds(
    ref,
    `${instanceKey}:${mode}`,
    (rect) => useMiniAppStore.getState().updateSlot(instanceKey, mode, rect),
    () => useMiniAppStore.getState().unregisterSlot(instanceKey, mode),
  )

  return <div ref={ref} className={className} />
}
