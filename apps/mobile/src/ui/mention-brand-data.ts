import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import type { MobileColorScheme } from '../theme/tokens'
import data from './mention-brands.generated.json'

const variants: Record<string, Record<string, Record<string, string>>> = data.variants
const images: Record<string, string> = data.images

export function mentionBrandArtwork(ref: string, scheme: MobileColorScheme, foreground: string): string | undefined {
  const artwork = variants[scheme]?.[foreground]
  if (!artwork) return undefined
  const brand = brandKeyForAgentRef(ref)
  // Match the shared desktop resolver's custom ACP and display aliases.
  const key = Object.hasOwn(artwork, brand) ? brand : brand.includes('grok') ? 'acp-grok'
    : brand.startsWith('acp') ? 'acp' : brand === 'deepseek' ? 'dsh' : '$unknown'
  const id = artwork[key]
  return id ? images[id] : undefined
}
