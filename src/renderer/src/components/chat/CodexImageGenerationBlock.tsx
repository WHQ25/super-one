import { useEffect, useRef, useState } from 'react'
import { Download, ImageIcon, Loader2, AlertCircle, X, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { cn } from '@/lib/utils'
import type { CodexImageGenerationItem } from '../../../../shared/agent-types'

interface Props {
  item: CodexImageGenerationItem
}

interface ImageDims {
  width: number
  height: number
}

function buildDefaultName(item: CodexImageGenerationItem): string {
  const slugSource = item.revisedPrompt?.trim() || `image-${item.id}`
  const slug = slugSource
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'generated-image'}.png`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function CodexImageGenerationBlock({ item }: Props) {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [generationMs, setGenerationMs] = useState<number | null>(null)
  const [dims, setDims] = useState<ImageDims | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)

  const isFailed = item.status === 'failed'
  const savedPath = item.savedPath
  const isWaiting = !savedPath && !isFailed

  const mountStartRef = useRef(Date.now())
  const initialHadSavedPathRef = useRef(!!savedPath)

  useEffect(() => {
    if (!isWaiting) return
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - mountStartRef.current)
    }, 500)
    return () => window.clearInterval(id)
  }, [isWaiting])

  useEffect(() => {
    if (savedPath && !initialHadSavedPathRef.current && generationMs === null) {
      setGenerationMs(Date.now() - mountStartRef.current)
    }
  }, [savedPath, generationMs])

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
      if (res.ok) {
        setDataUri(res.dataUri)
      } else {
        setLoadError(res.error)
      }
    })
    return () => { cancelled = true }
  }, [savedPath, isFailed])

  const handleDownload = async () => {
    if (!savedPath || downloading) return
    setDownloading(true)
    setDownloadStatus(null)
    try {
      const res = await window.app.saveFileAs(savedPath, buildDefaultName(item))
      if (res.ok) {
        setDownloadStatus(`Saved to ${res.savedPath}`)
      } else if (!res.canceled) {
        setDownloadStatus(`Failed: ${res.error ?? 'unknown error'}`)
      }
    } finally {
      setDownloading(false)
    }
  }

  if (isFailed) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Image generation failed.</span>
      </div>
    )
  }

  if (isWaiting) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>Generating image… {formatDuration(elapsedMs)}</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Failed to load image: {loadError}</span>
      </div>
    )
  }

  if (!dataUri) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span>Loading image…</span>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        className={cn(
          'my-1 block overflow-hidden rounded-md border border-border bg-muted/30',
          'cursor-zoom-in transition-shadow hover:shadow-sm',
        )}
      >
        <img
          src={dataUri}
          alt={item.revisedPrompt ?? 'Generated image'}
          onLoad={(e) => setDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          className="block h-80 w-auto max-w-full object-contain"
        />
      </button>

      <Dialog open={fullscreen} onOpenChange={setFullscreen} modal={false}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{item.revisedPrompt ?? 'Generated image'}</DialogTitle>
          <div className="absolute inset-0 px-[5vw] py-[5vh]">
            <ImagePreview src={dataUri} alt={item.revisedPrompt ?? 'Generated image'} />
          </div>

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
    </>
  )
}
