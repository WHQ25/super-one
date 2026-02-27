import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

type PdfSource = { base64: string } | { url: string }

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

export function PdfPreview(props: PdfSource & { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const pageWidthRef = useRef(0)
  const manualZoomRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)

  const sourceKey = 'base64' in props ? props.base64 : props.url

  const renderPages = useCallback(async (scale: number) => {
    const container = containerRef.current
    const pdf = pdfRef.current
    if (!container || !pdf) return

    container.innerHTML = ''
    const dpr = window.devicePixelRatio || 1

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: scale * dpr })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / dpr}px`
      canvas.style.height = `${viewport.height / dpr}px`
      canvas.style.display = 'block'
      container.appendChild(canvas)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const container = containerRef.current
      if (!container) return

      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).href

        const source = 'base64' in props
          ? { data: Uint8Array.from(atob(props.base64), (c) => c.charCodeAt(0)) }
          : { url: props.url }
        const pdf = await pdfjs.getDocument(source).promise
        if (cancelled) return

        pdfRef.current = pdf
        setPageCount(pdf.numPages)

        const containerWidth = container.clientWidth || 600
        const firstPage = await pdf.getPage(1)
        pageWidthRef.current = firstPage.getViewport({ scale: 1 }).width
        manualZoomRef.current = false
        const fitScale = (containerWidth - 32) / pageWidthRef.current
        setZoom(fitScale)

        await renderPages(fitScale)
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [sourceKey, renderPages])

  useEffect(() => {
    if (!loading && pdfRef.current) renderPages(zoom)
  }, [zoom, loading, renderPages])

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl || loading) return
    const ro = new ResizeObserver(() => {
      if (manualZoomRef.current || !pageWidthRef.current) return
      const w = scrollEl.clientWidth || 600
      setZoom((w - 32) / pageWidthRef.current)
    })
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [loading])

  const zoomIn = useCallback(() => { manualZoomRef.current = true; setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX)) }, [])
  const zoomOut = useCallback(() => { manualZoomRef.current = true; setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN)) }, [])
  const resetZoom = useCallback(() => {
    manualZoomRef.current = false
    const scrollEl = scrollRef.current
    if (!scrollEl || !pageWidthRef.current) return
    setZoom((scrollEl.clientWidth || 600 - 32) / pageWidthRef.current)
  }, [])

  return (
    <div className={cn('relative flex flex-col overflow-hidden bg-muted/30', props.className ?? 'max-h-[80vh]')}>
      {!loading && pageCount > 0 && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-b px-3 py-1.5">
          <button onClick={zoomOut} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ZoomOut className="size-3.5" />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ZoomIn className="size-3.5" />
          </button>
          <button onClick={resetZoom} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <RotateCcw className="size-3.5" />
          </button>
          <span className="ml-2 text-xs text-muted-foreground">{pageCount} pages</span>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            {pageCount > 0 && <span className="ml-2 text-sm text-muted-foreground">Loading {pageCount} pages...</span>}
          </div>
        )}
        <div ref={containerRef} className="mx-auto flex flex-col items-center gap-3" />
      </div>
    </div>
  )
}
