import { useRef, type DragEvent, type MouseEvent, type MutableRefObject } from 'react'
import { FileChipIcon } from './FileChipIcon'
import { cn } from '@superone/ui/lib/utils'
import { buildDragImagePng, preloadDragIcons, loadIconFromSvgElement } from '@/components/sidebar/drag-image-builder'

preloadDragIcons()

/**
 * Props that make an element drag `filePath` out as a real file. The drag image
 * reuses the thumbnail or first `<svg>` inside the element, so put them on whatever holds the
 * file icon. `dragEndRef` records when the drag ended, for click suppression.
 */
export function useFileDragProps(name: string, filePath: string | undefined, dragEndRef?: MutableRefObject<number>) {
  const dragIconRef = useRef<HTMLImageElement | null>(null)
  const thumbnailRef = useRef(false)
  if (!filePath) return undefined

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    const svg = e.currentTarget.querySelector('svg')
    const thumbnail = e.currentTarget.querySelector<HTMLImageElement>('img[data-file-thumbnail]')
    thumbnailRef.current = Boolean(thumbnail?.complete && thumbnail.naturalWidth > 0)
    dragIconRef.current = thumbnailRef.current ? thumbnail : svg ? loadIconFromSvgElement(svg) : null
  }
  const onDragStart = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const dragName = thumbnailRef.current ? filePath.split(/[/\\]/).pop() || name : name
    const dragImage = buildDragImagePng(dragName, false, dragIconRef.current, thumbnailRef.current)
      ?? (thumbnailRef.current ? buildDragImagePng(dragName, false) : null)
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

  if (!dragProps) return <span className={cn('shrink-0', className)}><FileChipIcon name={iconName} filePath={filePath} size={size} /></span>

  return (
    <span
      {...dragProps}
      className={cn('inline-flex items-center cursor-grab active:cursor-grabbing', className)}
    >
      <FileChipIcon name={iconName} filePath={filePath} size={size} />
    </span>
  )
}
