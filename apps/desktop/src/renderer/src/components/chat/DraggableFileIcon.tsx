import { useRef, type MutableRefObject } from 'react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { buildDragImagePng, preloadDragIcons, loadIconFromSvgElement } from '@/components/sidebar/drag-image-builder'

preloadDragIcons()

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
  const dragIconRef = useRef<HTMLImageElement | null>(null)
  // `name` is the display label, which markdown links may override with prose
  // ("通用电源设置 UI"). The extension lives on the path — resolve the icon from
  // there so a custom link text can't downgrade the chip to the default icon.
  const iconName = filePath?.split(/[/\\]/).pop() || name

  if (!filePath) return <FileIcon name={iconName} size={size} className={cn('shrink-0', className)} />

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const svg = e.currentTarget.querySelector('svg')
    if (svg) dragIconRef.current = loadIconFromSvgElement(svg)
  }
  const handleDragStart = (e: React.DragEvent): void => {
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

  return (
    <span
      draggable
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      className={cn('inline-flex items-center cursor-grab active:cursor-grabbing', className)}
    >
      <FileIcon name={iconName} size={size} className="shrink-0" />
    </span>
  )
}
