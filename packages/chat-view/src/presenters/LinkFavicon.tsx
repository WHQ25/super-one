import { useEffect, useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import { useIsCodeFenceIncomplete } from 'streamdown'

const faviconClass = 'mr-1 inline-block size-[0.9em] shrink-0 object-contain align-[-0.1em]'

export type FaviconAnalysis = { monochrome: boolean; transparent: boolean; luminance: number }
type FaviconSource = 'globe' | { dataUrl: string; analysis: FaviconAnalysis | null }

export interface LinkFaviconPorts {
  /**
   * Resolve a page URL to its icon as a data URL, or null when none can be
   * found. The desktop answers from its own favicon cache; the phone asks the
   * desktop through the host bridge so both surfaces show the same icon.
   */
  resolveFavicon(href: string, isDark: boolean): Promise<string | null>
}

export function analyzeFavicon(img: HTMLImageElement): FaviconAnalysis | null {
  try {
    const w = Math.min(img.naturalWidth || 32, 32)
    const h = Math.min(img.naturalHeight || 32, 32)
    if (!w || !h) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    let opaque = 0
    let colored = 0
    let translucent = 0
    let lumSum = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) {
        translucent++
        continue
      }
      opaque++
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored++
      lumSum += (0.299 * r + 0.587 * g + 0.114 * b) / 255
    }
    if (!opaque) return null
    const total = opaque + translucent
    return { monochrome: colored / opaque < 0.02, transparent: translucent / total > 0.05, luminance: lumSum / opaque }
  } catch {
    return null
  }
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function needsContrastBoost(dataUrl: string, analysis: FaviconAnalysis | null, isDark: boolean): boolean {
  if (!analysis || !analysis.monochrome || !analysis.transparent) return false
  if (!/^data:image\/(svg\+xml|png)/.test(dataUrl)) return false
  return contrastRatio(analysis.luminance, isDark ? 0.12 : 0.98) < 3
}

export function isHttpHref(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The site icon in front of an external markdown link. A globe stands in until
 * the host answers (or when it cannot); a monochrome transparent icon that
 * would vanish against the current background is re-tinted with the
 * foreground colour through a mask instead of drawn as-is.
 */
export function LinkFaviconPresenter({ href, isDark, ports }: { href: string; isDark: boolean; ports: LinkFaviconPorts }) {
  const incomplete = useIsCodeFenceIncomplete()
  const [source, setSource] = useState<FaviconSource>('globe')
  const isHttp = useMemo(() => isHttpHref(href), [href])

  useEffect(() => {
    if (!isHttp || incomplete) return
    let cancelled = false
    void ports.resolveFavicon(href, isDark).then((dataUrl) => {
      if (cancelled) return
      // Paint as soon as the host answers. A pre-decode Image() here used to
      // swallow ICO data URLs on WKWebView (onload never fired) and leave the
      // globe up even when an <img> could have shown a PNG/SVG.
      if (!dataUrl) setSource('globe')
      else setSource({ dataUrl, analysis: null })
    }, () => { if (!cancelled) setSource('globe') })
    return () => { cancelled = true }
  }, [href, isHttp, incomplete, isDark, ports])

  if (!isHttp) return null
  if (source === 'globe') return <Globe className={`${faviconClass} text-muted-foreground`} />
  const scheme = isDark ? 'dark' : 'light'
  if (needsContrastBoost(source.dataUrl, source.analysis, isDark)) {
    const mask = `url("${source.dataUrl}")`
    return (
      <span
        aria-hidden
        className={`${faviconClass} bg-foreground`}
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    )
  }
  return (
    <img
      key={scheme}
      src={source.dataUrl}
      alt=""
      className={faviconClass}
      style={{ colorScheme: scheme }}
      onLoad={(event) => {
        const analysis = analyzeFavicon(event.currentTarget)
        setSource((current) => (
          current === 'globe' || current.dataUrl !== source.dataUrl
            ? current
            : { dataUrl: source.dataUrl, analysis }
        ))
      }}
      onError={() => setSource('globe')}
    />
  )
}
