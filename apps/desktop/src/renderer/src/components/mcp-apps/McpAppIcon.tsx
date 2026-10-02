import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { mcpAppMonochromeSvg } from '@superone/shared/mcp-apps-metadata'

/**
 * A server- or tool-supplied icon. A one-colour SVG is painted as a mask in the
 * current text colour, so it follows the theme like the host's own glyphs;
 * anything else is shown as the image it is. `fallback` covers a missing or
 * broken image.
 */
export function McpAppIcon({ src, className, fallback }: { src?: string; className?: string; fallback: ReactNode }) {
  const mask = useMemo(() => {
    const svg = src ? mcpAppMonochromeSvg(src) : undefined
    if (svg === undefined) return undefined
    // Re-encoded, so the CSS url() never sees quotes or newlines from the server's markup.
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    return { maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' } satisfies CSSProperties
  }, [src])
  const [broken, setBroken] = useState<string>()
  if (!src || broken === src) return <>{fallback}</>
  if (mask) return <span aria-hidden className={cn('block bg-current', className)} style={mask} />
  return <img src={src} alt="" draggable={false} onError={() => setBroken(src)} className={cn('rounded-sm object-contain', className)} />
}
