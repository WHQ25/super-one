import { memo, useContext, useLayoutEffect, useMemo, useState } from 'react'
import { Block, StreamdownContext, type BlockProps } from 'streamdown'
import { createStreamFadePlugin, FadeBlockInnerContext } from './stream-fade'

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
