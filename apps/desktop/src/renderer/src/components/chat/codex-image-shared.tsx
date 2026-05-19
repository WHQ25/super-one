import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X, Info, ChevronLeft, ChevronRight, Copy, FolderOpen, MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@superone/ui/components/ui/context-menu'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { toast } from 'sonner'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { chatInputAPI } from './ChatInput'
import type { CodexImageGenerationItem } from '@superone/shared/agent-types'

export function buildImageFileName(item: CodexImageGenerationItem): string {
  const slugSource = item.revisedPrompt?.trim() || `image-${item.id}`
  const slug = slugSource
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'generated-image'}.png`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function useImageDataUri(savedPath: string | undefined, isFailed: boolean) {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!savedPath || isFailed) {
      setDataUri(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    setLoadError(null)
    window.app.readFileAsDataUri(savedPath).then((res) => {
      if (cancelled) return
      if (res.ok) setDataUri(res.dataUri)
      else setLoadError(res.error)
    })
    return () => { cancelled = true }
  }, [savedPath, isFailed])

  return { dataUri, loadError }
}

function CodexImageMenuItems({ savedPath }: { savedPath: string }) {
  const { t } = useTranslation()
  const handleCopy = async () => {
    const res = await window.app.clipboardWriteImage(savedPath)
    if (res.ok) toast.success(t('chat.codexImage.copied'))
    else toast.error(t('chat.codexImage.copyFailed', { error: res.error }))
  }

  return (
    <>
      <ContextMenuItem onClick={handleCopy}>
        <Copy className="mr-2 size-3.5" />
        {t('chat.codexImage.copyImage')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => chatInputAPI.addImageFromPath?.(savedPath)}>
        <MessageSquarePlus className="mr-2 size-3.5" />
        {t('chat.codexImage.addToChat')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => window.app.revealFile(savedPath)}>
        <FolderOpen className="mr-2 size-3.5" />
        {t('chat.codexImage.openFolder')}
      </ContextMenuItem>
    </>
  )
}

function buildImageDragPng(img: HTMLImageElement): { buffer: ArrayBuffer; scaleFactor: number } | null {
  if (!img.complete || img.naturalWidth === 0) return null
  const MAX = 160
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  ctx.drawImage(img, 0, 0, w, h)
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  if (!base64) return null
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { buffer: bytes.buffer, scaleFactor: dpr }
}

interface InteractiveProps {
  savedPath: string
  onOpen: () => void
  className: string
  ariaLabel: string
  children: React.ReactNode
}

export function CodexImageInteractive({ savedPath, onOpen, className, ariaLabel, children }: InteractiveProps) {
  const dragEndRef = useRef(0)

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault()
    const imgEl = e.currentTarget.querySelector('img')
    const dragImage = imgEl ? buildImageDragPng(imgEl) : null
    if (dragImage) window.app.startDrag([savedPath], { png: dragImage.buffer, scaleFactor: dragImage.scaleFactor })
    else window.app.startDrag([savedPath])
    const cleanup = () => {
      dragEndRef.current = Date.now()
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
  }

  const handleClick = () => {
    if (Date.now() - dragEndRef.current < 200) return
    onOpen()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onClick={handleClick}
          aria-label={ariaLabel}
          className={className}
        >
          {children}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <CodexImageMenuItems savedPath={savedPath} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface ViewerProps {
  items: CodexImageGenerationItem[]
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
}

export function CodexImageViewer({ items, index, open, onOpenChange, onIndexChange }: ViewerProps) {
  const item = items[index]
  const { dataUri } = useImageDataUri(item?.savedPath, item?.status === 'failed')
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)

  const multi = items.length > 1
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  useEffect(() => {
    setDims(null)
    if (!dataUri) return
    const img = new Image()
    img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight })
    img.src = dataUri
  }, [dataUri])

  useEffect(() => {
    if (!open || !multi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onIndexChange(index - 1) }
      else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onIndexChange(index + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, multi, index, hasPrev, hasNext, onIndexChange])

  const handleDownload = async () => {
    if (!item?.savedPath || downloading) return
    setDownloading(true)
    setDownloadStatus(null)
    try {
      const res = await window.app.saveFileAs(item.savedPath, buildImageFileName(item))
      if (res.ok) setDownloadStatus(`Saved to ${res.savedPath}`)
      else if (!res.canceled) setDownloadStatus(`Failed: ${res.error ?? 'unknown error'}`)
    } finally {
      setDownloading(false)
    }
  }

  if (!item) return null
  const generationMs = item.generationMs ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{item.revisedPrompt ?? 'Generated image'}</DialogTitle>
        {(() => {
          const imageArea = (
            <div className="absolute inset-0 px-[5vw] py-[5vh]">
              {dataUri && <ImagePreview src={dataUri} alt={item.revisedPrompt ?? 'Generated image'} />}
            </div>
          )
          if (!item.savedPath) return imageArea
          return (
            <ContextMenu>
              <ContextMenuTrigger asChild>{imageArea}</ContextMenuTrigger>
              <ContextMenuContent>
                <CodexImageMenuItems savedPath={item.savedPath} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })()}

        {multi && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasPrev}
              onClick={() => onIndexChange(index - 1)}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="absolute left-3 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground disabled:opacity-30"
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasNext}
              onClick={() => onIndexChange(index + 1)}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="absolute right-3 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground disabled:opacity-30"
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </Button>
            <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-border/50 bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {index + 1} / {items.length}
            </div>
          </>
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="absolute right-[108px] top-3 z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground"
          onClick={() => setInfoOpen((v) => !v)}
          aria-label="Image info"
          aria-expanded={infoOpen}
        >
          <Info className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="absolute right-[60px] top-3 z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground"
          onClick={handleDownload}
          disabled={downloading}
          aria-label="Download image"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </Button>

        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="absolute right-3 top-3 z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>

        {infoOpen && (
          <div className="absolute right-3 top-14 z-20 w-80 rounded-md border border-border/50 bg-popover p-4 text-xs text-popover-foreground shadow-md">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                {dims && <span>{dims.width} × {dims.height}</span>}
                {dims && generationMs !== null && <span className="text-border">·</span>}
                {generationMs !== null && <span>Generated in {formatDuration(generationMs)}</span>}
                {!dims && generationMs === null && <span>No metadata available.</span>}
              </div>
              {item.revisedPrompt && (
                <SelectionContextMenuZone className="border-t pt-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Revised prompt
                  </div>
                  <div className="max-h-48 overflow-y-auto leading-relaxed">
                    {item.revisedPrompt}
                  </div>
                </SelectionContextMenuZone>
              )}
            </div>
          </div>
        )}

        {downloadStatus && (
          <div className="absolute right-3 top-14 z-20 max-w-[280px] truncate rounded-md border border-border/50 bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
            {downloadStatus}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
