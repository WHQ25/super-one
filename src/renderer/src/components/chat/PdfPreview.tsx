import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export function PdfPreview({ base64 }: { base64: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const container = containerRef.current
      if (!container) return

      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).href

        const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const pdf = await pdfjs.getDocument({ data }).promise
        if (cancelled) return

        setPageCount(pdf.numPages)
        container.innerHTML = ''

        const dpr = window.devicePixelRatio || 1
        const containerWidth = container.clientWidth || 600

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          if (cancelled) return

          const unscaled = page.getViewport({ scale: 1 })
          const cssScale = (containerWidth - 32) / unscaled.width
          const viewport = page.getViewport({ scale: cssScale * dpr })

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

        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [base64])

  return (
    <div className="relative max-h-[80vh] overflow-y-auto bg-muted/30 p-4">
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          {pageCount > 0 && <span className="ml-2 text-sm text-muted-foreground">Loading {pageCount} pages...</span>}
        </div>
      )}
      <div ref={containerRef} className="mx-auto flex flex-col items-center gap-3" />
    </div>
  )
}
