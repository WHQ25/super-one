import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MermaidThemeId } from './mermaid-themes'
import { MERMAID_PREVIEW_SOURCE } from './mermaid-themes'

const PREVIEW_SURFACES: Record<'light' | 'dark', string> = {
  light: '#faf9f7',
  dark: '#1c1c1c',
}

export function MermaidThemePreview({
  themeId,
  scheme,
}: {
  themeId: MermaidThemeId
  scheme: 'light' | 'dark'
}) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** True while a render is in flight (first paint or theme switch). */
  const [loading, setLoading] = useState(true)
  const renderGen = useRef(0)

  useEffect(() => {
    let cancelled = false
    const gen = ++renderGen.current
    // Keep the previous SVG painted so the confirm dialog does not reflow
    // when the user flips themes. Only clear error; first paint has no svg.
    setError(null)
    setLoading(true)

    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: themeId,
          securityLevel: 'loose',
          suppressErrorRendering: true,
          // Compact sequence preview so multi-actor color themes (redux-color) are visible.
          sequence: { actorMargin: 40, messageMargin: 24, mirrorActors: false },
        })
        const id = `mermaid-preview-${themeId}-${gen}`
        const { svg: result } = await mermaid.render(id, MERMAID_PREVIEW_SOURCE)
        if (!cancelled && gen === renderGen.current) {
          setSvg(result)
          setError(null)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled && gen === renderGen.current) {
          // Drop stale art only on failure so we don't flash the wrong theme forever.
          setSvg(null)
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [themeId])

  return (
    // Fixed height: theme swaps must not resize the confirm dialog.
    <div
      className="relative flex h-40 items-center justify-center overflow-hidden rounded-md border border-border p-3"
      style={{ backgroundColor: PREVIEW_SURFACES[scheme] }}
    >
      {error ? (
        <p className="px-2 text-center text-[11px] text-destructive">{error}</p>
      ) : svg ? (
        <div
          className="max-h-full w-full max-w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}

      {loading && (
        <div
          className={
            svg
              ? 'absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[1px]'
              : 'absolute inset-0 flex items-center justify-center'
          }
        >
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
