import { useState } from 'react'
import type { TextInputProps } from 'react-native'
import { PromptInput } from './PromptControls'

const MIN_HEIGHT = 40
const MAX_HEIGHT = 144

/** A single visual row grows with wrapping or newlines; Submit remains an explicit action. */
export function GrowingPromptInput(props: TextInputProps) {
  const [height, setHeight] = useState(MIN_HEIGHT)
  return <PromptInput {...props} multiline submitBehavior="newline" scrollEnabled={height >= MAX_HEIGHT}
    onContentSizeChange={event => {
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height))))
      props.onContentSizeChange?.(event)
    }} style={[{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, textAlignVertical: 'top' }, props.style]} />
}
