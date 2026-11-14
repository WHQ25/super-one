/**
 * A mod's `Svg` source reduced to inert drawing markup before it becomes an
 * `<img>` data URL. An image context already runs no script and loads nothing;
 * the allowlist keeps the document small and keeps a future context change
 * (inline SVG, an interactive frame) from inheriting active content.
 */
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'marker', 'filter',
  'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite',
].map((name) => name.toLowerCase()))

const ATTRIBUTE = /^(?:[a-z][a-z0-9-]*|viewBox|preserveAspectRatio|gradientUnits|gradientTransform|patternUnits|patternTransform|clipPathUnits|maskUnits|markerWidth|markerHeight|refX|refY|stdDeviation|textLength|lengthAdjust|startOffset|xmlns(?::xlink)?|xlink:href)$/

const isLocalRef = (value: string) => /^#[\w.-]+$/.test(value.trim())
const isSafeValue = (value: string) => !value.includes('\\') && !/url\(\s*(?!['"]?#)/i.test(value) && !/javascript:|data:|expression\(/i.test(value)
const isSafeStyleText = (value: string) => isSafeValue(value) && !/@import/i.test(value)
const MAX_USES = 16
const MAX_BACKDROP_USES = 512

export interface SanitizeSvgOptions {
  backdrop?: boolean
}

export function sanitizeSvg(source: string, options?: SanitizeSvgOptions): string | null {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null
  const allowBackdrop = options?.backdrop === true
  const maxUses = allowBackdrop ? MAX_BACKDROP_USES : MAX_USES
  let uses = 0
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const name = child.localName.toLowerCase()
      const allowed = ELEMENTS.has(name) || (allowBackdrop && name === 'style')
      if (!allowed || (name === 'use' && ++uses > maxUses)) {
        child.remove()
        continue
      }
      if (name === 'style') {
        if (!isSafeStyleText(child.textContent ?? '')) child.remove()
        continue
      }
      walk(child)
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name
      const keep =
        ATTRIBUTE.test(name) &&
        (name !== 'style' || allowBackdrop) &&
        !name.toLowerCase().startsWith('on') &&
        (name === 'href' || name === 'xlink:href' ? isLocalRef(attr.value) : isSafeValue(attr.value))
      if (!keep) el.removeAttribute(name)
    }
  }
  walk(root)
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(root)
}

export function svgDataUrl(source: string, options?: SanitizeSvgOptions): string | null {
  const clean = sanitizeSvg(source, options)
  return clean ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}` : null
}
