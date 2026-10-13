import { Block, type BlockProps } from 'streamdown'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { TranscriptStateScope, useTranscriptState } from '@superone/ui/lib/transcript-state'
import { useVirtualTranscript } from './virtual-transcript-context'
import { useVirtualBlockAnchor } from './virtual-block-anchor'

/** Streamdown supplies semantic blocks, including its reference-link context and streaming repair. */
export const VirtualMarkdownBlock = memo(function VirtualMarkdownBlock(props: BlockProps) {
  const transcript = useVirtualTranscript()
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!transcript)
  const [measured, setMeasured] = useTranscriptState(`markdown-size-${props.index}`, { height: 0, width: 0 })
  const height = useRef(measured.height)
  const [placeholder, setPlaceholder] = useState(measured.width ? measured.height : 96)
  useVirtualBlockAnchor(element, visible, placeholder)
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !transcript) return
    // Seed from content instead of mounting all paragraphs just to measure them.
    const width = node.clientWidth || 640
    const estimate = Math.max(28, Math.ceil(props.content.length / Math.max(20, width / 7)) * 22 + 12)
    setPlaceholder(measured.width === width ? measured.height : estimate)
    return transcript.observeBlock(node, setVisible)
  }, [transcript, props.content.length])
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !visible || !transcript) return
    const observer = new ResizeObserver(([entry]) => {
      height.current = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
      setMeasured(previous => Math.abs(previous.height - height.current) < 0.5 && Math.abs(previous.width - width) < 0.5 ? previous : { height: height.current, width })
      setPlaceholder(previous => Math.abs(previous - height.current) < 0.5 ? previous : height.current)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible, transcript])

  // Streamdown also emits whitespace separators. They render no DOM and must
  // not acquire placeholder height or extra gaps in the markdown document.
  if (!transcript || !props.content.trim()) return <Block {...props} />
  return <div ref={element} data-virtual-markdown-block={props.index} style={{ display: 'flow-root', ...(visible ? {} : { height: placeholder }) }}>
    {visible && <TranscriptStateScope id={`markdown-${props.index}`}><Block {...props} /></TranscriptStateScope>}
  </div>
})
