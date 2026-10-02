import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { mcpAppMonochromeSvg } from '@superone/shared/mcp-apps-metadata'
import { cn } from '../../lib/utils'

/**
 * A server- or tool-supplied icon. A one-colour SVG is painted as a mask in the
 * current text colour, so it follows the theme like the host's own glyphs;
 * anything else is shown as the image it is. `fallback` covers a missing or
 * broken image.
 */
export function McpAppIcon({ src, alt = '', className, fallback }: { src?: string; alt?: string; className?: string; fallback: ReactNode }) {
  const mask = useMemo(() => {
    const svg = src ? mcpAppMonochromeSvg(src) : undefined
    if (svg === undefined) return undefined
    // Re-encoded, so the CSS url() never sees quotes or newlines from the server's markup.
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    return { maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' } satisfies CSSProperties
  }, [src])
  const [broken, setBroken] = useState<string>()
  if (!src || broken === src) return <>{fallback}</>
  if (mask) return <span role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={cn('block bg-current', className)} style={mask} />
  return <img src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(src)} className={cn('rounded-sm object-contain', className)} />
}
