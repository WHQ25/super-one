import { useRef, type DragEvent, type MouseEvent, type MutableRefObject } from 'react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { buildDragImagePng, preloadDragIcons, loadIconFromSvgElement } from '@/components/sidebar/drag-image-builder'

preloadDragIcons()

/**
 * Props that make an element drag `filePath` out as a real file. The drag image
 * reuses the first `<svg>` inside the element, so put them on whatever holds the
 * file icon. `dragEndRef` records when the drag ended, for click suppression.
 */
export function useFileDragProps(name: string, filePath: string | undefined, dragEndRef?: MutableRefObject<number>) {
  const dragIconRef = useRef<HTMLImageElement | null>(null)
  if (!filePath) return undefined

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    const svg = e.currentTarget.querySelector('svg')
    if (svg) dragIconRef.current = loadIconFromSvgElement(svg)
  }
  const onDragStart = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const dragImage = buildDragImagePng(name, false, dragIconRef.current)
    if (dragImage) window.app.startDrag([filePath], { png: dragImage.buffer, scaleFactor: dragImage.scaleFactor })
    else window.app.startDrag([filePath])
    const cleanup = (): void => {
      if (dragEndRef) dragEndRef.current = Date.now()
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
  }
  return { draggable: true, onMouseDown, onDragStart }
}

export function DraggableFileIcon({
  name,
  filePath,
  size = 12,
  className,
  dragEndRef,
}: {
  name: string
  filePath?: string
  size?: number
  className?: string
  dragEndRef?: MutableRefObject<number>
}) {
  const dragProps = useFileDragProps(name, filePath, dragEndRef)
  // `name` is the display label, which markdown links may override with prose
  // ("通用电源设置 UI"). The extension lives on the path — resolve the icon from
  // there so a custom link text can't downgrade the chip to the default icon.
  const iconName = filePath?.split(/[/\\]/).pop() || name

  if (!dragProps) return <FileIcon name={iconName} size={size} className={cn('shrink-0', className)} />

  return (
    <span
      {...dragProps}
      className={cn('inline-flex items-center cursor-grab active:cursor-grabbing', className)}
    >
      <FileIcon name={iconName} size={size} className="shrink-0" />
    </span>
  )
}
