import { memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Block, StreamdownContext, type BlockProps } from 'streamdown'
import { appendFadeChunk, createStreamFadePlugin, FadeBlockInnerContext, STREAM_FADE_CLASS } from './stream-fade'

export const StreamFadeBlock = memo(function StreamFadeBlock(props: BlockProps) {
  const Inner = useContext(FadeBlockInnerContext) ?? Block
  const [controller] = useState(() => createStreamFadePlugin())
  const streaming = useContext(StreamdownContext).isAnimating
  controller.bind()
  useLayoutEffect(() => {
    if (!streaming) {
      controller.reset()
      return
    }
    controller.commit()
    return () => controller.unbind()
  }, [streaming, props.content, controller])
  const rehypePlugins = useMemo(
    () => streaming ? [...(props.rehypePlugins ?? []), controller.rehype] : props.rehypePlugins,
    [props.rehypePlugins, streaming, controller],
  )
  return <Inner {...props} rehypePlugins={rehypePlugins} />
})

export function StreamFadeText({ text, active }: { text: string, active: boolean }) {
  const stored = useRef({ chunks: [] as string[], previous: '' })
  const shown = active ? appendFadeChunk(stored.current.chunks, stored.current.previous, text) : null
  useLayoutEffect(() => {
    if (!active) {
      stored.current = { chunks: [], previous: '' }
      return
    }
    stored.current = appendFadeChunk(stored.current.chunks, stored.current.previous, text)
  }, [active, text])
  if (!shown) return <>{text}</>
  return (
    <>
      {shown.chunks.map((chunk, index) => (
        <span key={`${index}:${chunk}`} className={STREAM_FADE_CLASS}>{chunk}</span>
      ))}
    </>
  )
}
