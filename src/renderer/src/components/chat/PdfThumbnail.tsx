import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

const THUMBNAIL_SIZE = 96

export function PdfThumbnail({ base64, className }: { base64: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).href

        const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const pdf = await pdfjs.getDocument({ data }).promise
        const page = await pdf.getPage(1)

        const unscaled = page.getViewport({ scale: 1 })
        const scale = THUMBNAIL_SIZE / Math.min(unscaled.width, unscaled.height)
        const viewport = page.getViewport({ scale })

        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height

        const ctx = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport }).promise

        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) {
          setLoading(false)
          setError(true)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [base64])

  if (error) {
    return <div className={`flex items-center justify-center bg-muted/50 text-[8px] text-muted-foreground ${className ?? ''}`}>PDF</div>
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        </div>
      )}
      <canvas ref={canvasRef} className="size-full object-cover" />
    </div>
  )
}
