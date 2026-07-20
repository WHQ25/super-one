import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, X, Info, ChevronLeft, ChevronRight, Copy, FolderOpen, MessageSquarePlus, ClipboardCopy, ImageIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { toast } from 'sonner'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { chatInputAPI } from './ChatInput'
import { useAppStore } from '@/stores/app'
import type { ImageGenerationItem, MediaProviderStatus } from '@superone/shared/agent-types'

const isWindows = window.app.platform === 'win32'

export function buildImageFileName(item: ImageGenerationItem): string {
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

export function ImageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('image-skeleton flex items-center justify-center', className)}>
      <ImageIcon className="size-6 animate-breathe text-muted-foreground" />
    </div>
  )
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

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

export function useImageMenuItems({ savedPath, prompt, downloadable }: { savedPath: string; prompt?: string; downloadable?: boolean }): AdaptiveMenuEntry[] {
  const { t } = useTranslation()
  const handleCopy = async () => {
    const res = await window.app.clipboardWriteImage(savedPath)
    if (res.ok) toast.success(t('chat.image.copied'))
    else toast.error(t('chat.image.copyFailed', { error: res.error }))
  }
  const handleCopyPrompt = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success(t('chat.image.promptCopied'))
    } catch (error) {
      toast.error(t('chat.image.copyFailed', { error: String(error) }))
    }
  }
  const handleDownload = async () => {
    const defaultDir = useAppStore.getState().currentFolder ?? undefined
    const res = await window.app.saveFileAs(savedPath, basename(savedPath), defaultDir)
    if (res.ok) toast.success(t('chat.image.downloaded', { path: res.savedPath }))
    else if (!res.canceled) toast.error(t('chat.image.downloadFailed', { error: res.error }))
  }

  return [
    { kind: 'item', id: 'copy', label: t('chat.image.copyImage'), icon: Copy, onSelect: () => { void handleCopy() } },
    ...(downloadable
      ? ([{ kind: 'item', id: 'download', label: t('chat.image.download'), icon: Download, onSelect: () => { void handleDownload() } }] as AdaptiveMenuEntry[])
      : []),
    ...(prompt
      ? ([{ kind: 'item', id: 'copyPrompt', label: t('chat.image.copyPrompt'), icon: ClipboardCopy, onSelect: () => { void handleCopyPrompt() } }] as AdaptiveMenuEntry[])
      : []),
    { kind: 'item', id: 'addToChat', label: t('chat.image.addToChat'), icon: MessageSquarePlus, onSelect: () => chatInputAPI.addImageFromPath?.(savedPath) },
    { kind: 'item', id: 'openFolder', label: t('chat.image.openFolder'), icon: FolderOpen, onSelect: () => window.app.revealFile(savedPath) },
  ]
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
  let base64: string | undefined
  try {
    base64 = canvas.toDataURL('image/png').split(',')[1]
  } catch {
    return null
  }
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
  prompt?: string
  downloadable?: boolean
  children: React.ReactNode
}

export function ImageInteractive({ savedPath, onOpen, className, ariaLabel, prompt, downloadable, children }: InteractiveProps) {
  const dragEndRef = useRef(0)
  const menuItems = useImageMenuItems({ savedPath, prompt, downloadable })

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
    <AdaptiveContextMenu items={menuItems}>
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
    </AdaptiveContextMenu>
  )
}

interface ViewerProps {
  items: ImageGenerationItem[]
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
}

const PARAM_LABEL_KEYS: Record<string, string> = {
  provider: 'chat.image.paramProvider',
  model: 'chat.image.paramModel',
  size: 'chat.image.paramSize',
  aspectRatio: 'chat.image.paramAspectRatio',
}

let mediaProvidersCache: MediaProviderStatus[] | null = null
let mediaProvidersPromise: Promise<MediaProviderStatus[]> | null = null

function useMediaProviderMap(enabled: boolean): Map<string, MediaProviderStatus> {
  const [providers, setProviders] = useState<MediaProviderStatus[]>(mediaProvidersCache ?? [])
  useEffect(() => {
    if (!enabled || mediaProvidersCache) return
    let cancelled = false
    if (!mediaProvidersPromise) {
      mediaProvidersPromise = window.app.getMediaProviders().then((list) => {
        mediaProvidersCache = list
        return list
      }).catch((error) => {
        mediaProvidersPromise = null
        throw error
      })
    }
    mediaProvidersPromise.then((list) => { if (!cancelled) setProviders(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
}

function ProviderParamValue({ id, providerMap }: { id: string; providerMap: Map<string, MediaProviderStatus> }) {
  const info = providerMap.get(id)
  if (!info) return <dd className="break-all text-right text-foreground">{id}</dd>
  return (
    <dd className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-foreground">{info.providerLabel ?? info.label}</span>
      {info.providerLabel && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{info.label}</span>
      )}
    </dd>
  )
}

function resolveModelLabel(modelId: string, providerId: string | undefined, providerMap: Map<string, MediaProviderStatus>): string {
  const preferred = providerId ? providerMap.get(providerId)?.models : undefined
  const inPreferred = preferred?.find((m) => m.id === modelId)
  if (inPreferred) return inPreferred.label
  for (const provider of providerMap.values()) {
    const match = provider.models.find((m) => m.id === modelId)
    if (match) return match.label
  }
  return modelId
}

function ModelParamValue({ id, providerId, providerMap }: { id: string; providerId?: string; providerMap: Map<string, MediaProviderStatus> }) {
  const label = resolveModelLabel(id, providerId, providerMap)
  return <dd className="break-all text-right text-foreground" title={id}>{label}</dd>
}

function ReferenceImageThumb({ path }: { path: string }) {
  const { dataUri, loadError } = useImageDataUri(path, false)
  const name = path.split(/[/\\]/).pop() || path

  if (loadError) {
    return (
      <div
        title={`${path} — ${loadError}`}
        className="flex aspect-square w-full items-center justify-center rounded border border-destructive/30 bg-destructive/5"
      >
        <ImageIcon className="size-4 text-destructive/70" />
      </div>
    )
  }
  if (!dataUri) return <ImageSkeleton className="aspect-square w-full rounded border border-border/50" />

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <img
          src={dataUri}
          alt={name}
          className="aspect-square w-full cursor-zoom-in rounded border border-border/50 bg-muted/30 object-cover transition-colors hover:border-border"
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        sideOffset={12}
        className="w-auto max-w-[min(42vw,520px)] overflow-hidden rounded-lg p-1.5"
      >
        <img
          src={dataUri}
          alt={name}
          className="max-h-[60vh] w-auto max-w-full rounded object-contain"
        />
        <div className="truncate px-1 pb-0.5 pt-1.5 text-[10px] text-muted-foreground" title={path}>
          {name}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

export function ImageViewer({ items, index, open, onOpenChange, onIndexChange }: ViewerProps) {
  const { t } = useTranslation()
  const item = items[index]
  const { dataUri } = useImageDataUri(item?.savedPath, item?.status === 'failed')
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const providerMap = useMediaProviderMap(infoOpen)
  const providerParamId = item?.params?.find((p) => p.key === 'provider')?.value

  const menuItems = useImageMenuItems({ savedPath: item?.savedPath ?? '', prompt: item?.revisedPrompt, downloadable: true })
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
      const defaultDir = useAppStore.getState().currentFolder ?? undefined
      const res = await window.app.saveFileAs(item.savedPath, buildImageFileName(item), defaultDir)
      if (res.ok) setDownloadStatus(`Saved to ${res.savedPath}`)
      else if (!res.canceled) setDownloadStatus(`Failed: ${res.error ?? 'unknown error'}`)
      setDownloading(false)
    } catch (e) {
      setDownloading(false)
      throw e
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
            <AdaptiveContextMenu items={menuItems}>{imageArea}</AdaptiveContextMenu>
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
              className="absolute left-3 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground disabled:opacity-30"
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
              className="absolute right-3 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground disabled:opacity-30"
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </Button>
            <div className={cn(
              "absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-border/50 bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
              isWindows ? "top-12" : "top-3"
            )}>
              {index + 1} / {items.length}
            </div>
          </>
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            "absolute right-[108px] z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
            isWindows ? "top-12" : "top-3"
          )}
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
          className={cn(
            "absolute right-[60px] z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
            isWindows ? "top-12" : "top-3"
          )}
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
            className={cn(
              "absolute right-3 z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
              isWindows ? "top-12" : "top-3"
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>

        {infoOpen && (
          <div className={cn(
            "absolute right-3 z-20 max-h-[80vh] w-80 overflow-y-auto rounded-md border border-border/50 bg-popover p-4 text-xs text-popover-foreground shadow-md",
            isWindows ? "top-[84px]" : "top-14"
          )}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                {dims && <span>{dims.width} × {dims.height}</span>}
                {dims && generationMs !== null && <span className="text-border">·</span>}
                {generationMs !== null && <span>{t('chat.image.generatedIn', { duration: formatDuration(generationMs) })}</span>}
                {!dims && generationMs === null && !item.params?.length && !item.referenceImagePaths?.length && <span>{t('chat.image.noMetadata')}</span>}
              </div>
              {item.params && item.params.length > 0 && (
                <dl className="flex flex-col gap-1 border-t pt-2">
                  {item.params.map((p) => (
                    <div key={p.key} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {PARAM_LABEL_KEYS[p.key] ? t(PARAM_LABEL_KEYS[p.key]) : p.key}
                      </dt>
                      {p.key === 'provider' ? (
                        <ProviderParamValue id={p.value} providerMap={providerMap} />
                      ) : p.key === 'model' ? (
                        <ModelParamValue id={p.value} providerId={providerParamId} providerMap={providerMap} />
                      ) : (
                        <dd className="break-all text-right text-foreground">{p.value}</dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
              {item.referenceImagePaths && item.referenceImagePaths.length > 0 && (
                <div className="border-t pt-2">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('chat.image.paramReferenceImages')}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {item.referenceImagePaths.map((p) => (
                      <ReferenceImageThumb key={p} path={p} />
                    ))}
                  </div>
                </div>
              )}
              {item.warnings && item.warnings.length > 0 && (
                <div className="border-t pt-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    {t('chat.image.warnings')}
                  </div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 leading-relaxed text-muted-foreground">
                    {item.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.revisedPrompt && (
                <SelectionContextMenuZone className="border-t pt-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('chat.image.prompt')}
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
          <div className={cn(
            "absolute right-3 z-20 max-w-[280px] truncate rounded-md border border-border/50 bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm",
            isWindows ? "top-[84px]" : "top-14"
          )}>
            {downloadStatus}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
