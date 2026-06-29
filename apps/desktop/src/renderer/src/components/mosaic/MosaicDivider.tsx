import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@superone/ui/lib/utils'
import { ResizeHandleLine } from '@/components/ResizeHandleLine'
import { useMosaicStore } from './mosaic-store'
import { clampRatioToMin, type MosaicPath } from './mosaic-tree'

interface MosaicDividerProps {
  direction: 'row' | 'column'
  path: MosaicPath
  firstMin: number
  secondMin: number
}

export function MosaicDivider({ direction, path, firstMin, secondMin }: MosaicDividerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const horizontal = direction === 'row'

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const rect = rectRef.current
      if (!rect) return
      const size = horizontal ? rect.width : rect.height
      const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top
      const raw = size > 0 ? pos / size : 0.5
      useMosaicStore.getState().setRatio(path, clampRatioToMin(raw, size, firstMin, secondMin))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, horizontal, path, firstMin, secondMin])

  return (
    <>
      <div ref={ref} className={cn('group relative z-10 shrink-0', horizontal ? 'w-px' : 'h-px')}>
        {/* Always-on hairline that draws the card division */}
        <div className="absolute inset-0 bg-border" />
        {/* Hover/active emphasis — simple line highlight shared with the other in-card handles */}
        <ResizeHandleLine orientation={horizontal ? 'vertical' : 'horizontal'} active={dragging} />
        <div
          onPointerDown={(e) => {
            const parent = ref.current?.parentElement
            if (!parent) return
            rectRef.current = parent.getBoundingClientRect()
            e.preventDefault()
            setDragging(true)
          }}
          className={cn('absolute z-10', horizontal ? '-inset-x-1 inset-y-0 cursor-col-resize' : '-inset-y-1 inset-x-0 cursor-row-resize')}
        />
      </div>
      {dragging && createPortal(
        <div className="fixed inset-0 z-[9998]" style={{ cursor: horizontal ? 'col-resize' : 'row-resize' }} />,
        document.body,
      )}
    </>
  )
}
