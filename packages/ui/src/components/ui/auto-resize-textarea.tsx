import { useCallback, useImperativeHandle, useLayoutEffect, useRef, type ComponentProps } from 'react'
import { Textarea } from './textarea'
import { cn } from '../../lib/utils'

type AutoResizeTextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'defaultValue' | 'onChange' | 'onSubmit' | 'rows'> & {
  value: string
  onValueChange: (value: string) => void
  /** Plain Enter submits; Shift+Enter and Alt+Enter insert a newline. */
  onSubmit?: () => void
  maxRows?: number
}

/** A controlled textarea that starts at one row and follows content and pane width. */
export function AutoResizeTextarea({
  ref, value, onValueChange, onSubmit, onKeyDown, maxRows = 5, className, ...props
}: AutoResizeTextareaProps) {
  const elementRef = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => elementRef.current!, [])

  const resize = useCallback(() => {
    const element = elementRef.current
    if (!element) return
    const style = getComputedStyle(element)
    const px = (value: string) => Number.parseFloat(value) || 0
    const line = px(style.lineHeight) || px(style.fontSize) * 1.5
    const padding = px(style.paddingTop) + px(style.paddingBottom)
    const border = px(style.borderTopWidth) + px(style.borderBottomWidth)
    const minimum = Math.max(line + padding + border, px(style.minHeight))
    const maximum = Math.max(minimum, line * Math.max(1, maxRows) + padding + border)
    element.style.overflowY = 'hidden'
    element.style.height = '0px'
    const height = element.value ? Math.max(minimum, element.scrollHeight + border) : minimum
    element.style.height = `${Math.min(height, maximum)}px`
    element.style.overflowY = height > maximum ? 'auto' : 'hidden'
  }, [maxRows])

  useLayoutEffect(resize, [value, resize])

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return
    let width = element.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      resize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [resize])

  return (
    <Textarea
      {...props}
      ref={elementRef}
      rows={1}
      value={value}
      className={cn('box-border resize-none overflow-y-hidden', className)}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && !props.readOnly && !props.disabled) {
          if (event.shiftKey || event.altKey) {
            event.preventDefault()
            event.stopPropagation()
            const element = event.currentTarget
            const nextLength = element.value.length - (element.selectionEnd - element.selectionStart) + 1
            if (props.maxLength !== undefined && nextLength > props.maxLength) return
            // Native editing keeps the caret and undo history; assigning a new value does not.
            if (element.ownerDocument.execCommand('insertText', false, '\n')) onValueChange(element.value)
            return
          }
          if (onSubmit) {
            event.preventDefault()
            event.stopPropagation()
            onSubmit()
            return
          }
        }
        onKeyDown?.(event)
      }}
    />
  )
}
