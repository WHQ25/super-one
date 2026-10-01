import { useMemo, useState } from 'react'
import { Image, View } from 'react-native'
import { FileText } from 'lucide-react-native'
import { parse, SvgXml, type XmlAST } from 'react-native-svg'
import { safeImageUri } from '@superone/shared/image-uri'
import { useMobileTheme } from '../theme/context'

const SVG_URI_MAX_BYTES = 32 * 1024
const VECTOR_TAGS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'use', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern'])
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
function safeValue(name: string, value: unknown): string | undefined {
  if (!/^[a-z][a-z0-9]*$/i.test(name) || /^on/i.test(name)) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  if (/^(?:href|xlinkHref)$/i.test(name) && !/^#[\w:.-]+$/.test(text)) return undefined
  if ([...text.matchAll(/url\((.*?)\)/gi)].some(match => !/^['"]?#[\w:.-]+['"]?$/.test(match[1]!.trim()))) return undefined
  return text
}

/** Decode small icon data only. Native SVG never executes scripts; external resources are omitted. */
export function contextSvgXml(src: string): string | undefined {
  if (src.length > SVG_URI_MAX_BYTES || new TextEncoder().encode(src).byteLength > SVG_URI_MAX_BYTES) return undefined
  const match = /^data:image\/svg\+xml((?:;[^,]*)?),(.*)$/is.exec(src)
  if (!match) return undefined
  try {
    const xml = /;base64/i.test(match[1]!)
      ? decodeURIComponent(Array.from(atob(match[2]!), char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
      : decodeURIComponent(match[2]!)
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return undefined
    let safe: string | undefined
    let nodes = 0
    function serialize(node: XmlAST, depth: number): string {
      if (++nodes > 512 || depth > 32) throw new Error('SVG icon is too complex')
      if (!VECTOR_TAGS.has(node.tag)) return ''
      const attributes = Object.entries(node.props).flatMap(([name, value]) => {
        if (name === 'style' && value && typeof value === 'object') {
          return Object.entries(value).flatMap(([key, field]) => {
            const allowed = safeValue(key, field)
            return allowed === undefined ? [] : [`${key}="${escapeXml(allowed)}"`]
          })
        }
        const allowed = safeValue(name, value)
        return allowed === undefined ? [] : [`${name}="${escapeXml(allowed)}"`]
      }).join(' ')
      const children = node.children.map(child => typeof child === 'string' ? escapeXml(child) : serialize(child, depth + 1)).join('')
      return `<${node.tag} ${attributes}>${children}</${node.tag}>`
    }
    parse(xml, root => {
      if (root.tag !== 'svg') throw new Error('Expected SVG icon')
      safe = serialize(root, 0)
      return { ...root, children: [] }
    })
    return safe
  } catch { return undefined }
}

export function ContextThumbnail({ src }: { src: string }) {
  const [nativeFailed, setNativeFailed] = useState(false)
  const { tokens: { colors } } = useMobileTheme()
  const xml = useMemo(() => contextSvgXml(src), [src])
  const fallback = <View testID="context-thumbnail-fallback"><FileText size={14} color={colors.mutedForeground} /></View>
  if (/^data:image\/svg\+xml[;,]/i.test(src)) return xml
    ? <SvgXml testID="context-thumbnail-svg" xml={xml} width={20} height={20} fallback={fallback} onError={() => {}} /> : fallback
  const uri = safeImageUri(src)
  if (nativeFailed || !uri) return fallback
  return <Image source={{ uri }} onError={() => setNativeFailed(true)} style={{ width: 20, height: 20, borderRadius: 4 }} />
}
