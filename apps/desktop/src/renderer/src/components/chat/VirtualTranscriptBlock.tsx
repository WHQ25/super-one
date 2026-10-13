import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranscriptState } from '@superone/ui/lib/transcript-state'
import { useVirtualTranscript } from './virtual-transcript-context'
import { usePlaceholderMargins, useVirtualBlockAnchor } from './virtual-block-anchor'

/** A long turn can contain thousands of rows inside a single message. */
export function VirtualTranscriptBlock({ children, cacheKey, estimate = 48, id }: {
  children: ReactNode
  cacheKey: string
  estimate?: number
  id?: string
}) {
  const transcript = useVirtualTranscript()
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!transcript)
  const [height, setHeight] = useTranscriptState(cacheKey, estimate)
  const margins = usePlaceholderMargins(`${cacheKey}-margins`, visible)
  const measured = useRef(height)
  useVirtualBlockAnchor(element, visible, height)

  useLayoutEffect(() => {
    const node = element.current
    if (!node || !transcript) return
    return transcript.observeBlock(node, next => {
      if (!next) margins.capture(node)
      setVisible(next)
    })
  }, [transcript, margins.capture])

  useLayoutEffect(() => {
    const node = element.current
    if (!node || !visible || !transcript) return
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      // Width animations can resize every visible block on every frame. Geometry
      // belongs in a ref until eviction; it must not cause another React commit.
      measured.current = next
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible, transcript])

  useLayoutEffect(() => {
    if (!visible) setHeight(previous => Math.abs(previous - measured.current) < 0.5 ? previous : measured.current)
  }, [visible, setHeight])

  if (!transcript) return <>{children}</>
  return <div
    ref={element}
    data-virtual-block={cacheKey}
    data-virtual-segment={id}
    style={visible ? undefined : { height, ...margins.style }}
  >{visible && children}</div>
}

export function VirtualTurnSegment({ children, estimate, id }: { children: ReactNode; estimate?: number; id: string }) {
  return <VirtualTranscriptBlock cacheKey={`turn-segment-height-${id}`} estimate={estimate} id={id}>
    <div className="space-y-1">{children}</div>
  </VirtualTranscriptBlock>
}
