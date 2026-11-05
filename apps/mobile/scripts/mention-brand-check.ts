import { assertSameRaster } from './raster-drift'

interface MentionBrands {
  pixels: number
  variants: Record<string, Record<string, Record<string, string>>>
  images: Record<string, string>
}

/**
 * Mention chips ship a Chromium screenshot per brand. Linux CI does not
 * byte-match a macOS `feGaussianBlur`, so the SHA-256 keys in the generated
 * JSON move even when the mark did not. Compare the pictures, and require
 * the scheme, foreground, and brand keys to stay exact.
 */
export function assertMentionBrandsCurrent(committedText: string, freshText: string): void {
  if (committedText === freshText) return
  const committed = parse(committedText)
  const fresh = parse(freshText)
  if (committed.pixels !== fresh.pixels) {
    throw new Error(`Native mention brands are stale (pixels ${committed.pixels} vs ${fresh.pixels}). Run generate:icons`)
  }
  for (const scheme of sameKeys(committed.variants, fresh.variants, 'scheme')) {
    const committedColors = committed.variants[scheme]!
    const freshColors = fresh.variants[scheme]!
    for (const color of sameKeys(committedColors, freshColors, `${scheme} foreground`)) {
      const committedBrands = committedColors[color]!
      const freshBrands = freshColors[color]!
      for (const brand of sameKeys(committedBrands, freshBrands, `${scheme} ${color}`)) {
        const committedPng = committed.images[committedBrands[brand]!]
        const freshPng = fresh.images[freshBrands[brand]!]
        if (!committedPng || !freshPng) {
          throw new Error(`Native mention brands are stale (${scheme} ${brand} image is missing). Run generate:icons`)
        }
        assertSameRaster(Buffer.from(committedPng, 'base64'), Buffer.from(freshPng, 'base64'), `Mention brand ${scheme} ${brand}`, 'Run generate:icons')
      }
    }
  }
}

function parse(text: string): MentionBrands {
  try {
    return JSON.parse(text) as MentionBrands
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Native mention brands are stale (${detail}). Run generate:icons`)
  }
}

function sameKeys(committed: object, fresh: object, label: string): string[] {
  const left = Object.keys(committed).sort()
  const right = Object.keys(fresh).sort()
  if (left.join('\0') !== right.join('\0')) {
    throw new Error(`Native mention brands are stale (${label}: ${left.join(',')} vs ${right.join(',')}). Run generate:icons`)
  }
  return left
}
