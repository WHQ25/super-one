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

/** A local fragment reference is the only link an SVG keeps. */
const isLocalRef = (value: string) => /^#[\w.-]+$/.test(value.trim())
/**
 * `url(#id)` paint references only; no external resources. A backslash is a
 * CSS escape (`\75 rl(`) that would hide a function from these checks.
 */
const isSafeValue = (value: string) => !value.includes('\\') && !/url\(\s*(?!['"]?#)/i.test(value) && !/javascript:|data:|expression\(/i.test(value)
/** Nested `<use>` multiplies: a few levels of a few copies each is millions of shapes. */
const MAX_USES = 16

export function sanitizeSvg(source: string): string | null {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null
  let uses = 0
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const name = child.localName.toLowerCase()
      if (!ELEMENTS.has(name) || (name === 'use' && ++uses > MAX_USES)) {
        child.remove()
        continue
      }
      walk(child)
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name
      // Presentation attributes draw the same; `style` is a CSS parser these checks cannot follow.
      const keep =
        ATTRIBUTE.test(name) &&
        name !== 'style' &&
        !name.toLowerCase().startsWith('on') &&
        (name === 'href' || name === 'xlink:href' ? isLocalRef(attr.value) : isSafeValue(attr.value))
      if (!keep) el.removeAttribute(name)
    }
  }
  walk(root)
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(root)
}

export function svgDataUrl(source: string): string | null {
  const clean = sanitizeSvg(source)
  return clean ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}` : null
}
