import type { ModElement } from '@superone/shared/mod-ui'

/** The CLI's own bounds for a tree (Client limits); a tree past them is not drawn. */
const MAX_NODES = 20_000
const MAX_DEPTH = 64

type Props = Record<string, unknown>

const isRecord = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v)
const isPrimitive = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const optional = (v: unknown, type: 'string' | 'number' | 'boolean') => v === undefined || typeof v === type
/** A flat record of primitives (style props, hover overrides), or absent. */
const primitives = (v: unknown) => v === undefined || (isRecord(v) && Object.values(v).every(isPrimitive))
const strings = (p: Props, ...keys: string[]) => keys.every((k) => optional(p[k], 'string'))
const isPress = (v: unknown) => isRecord(v) && typeof v.plugin === 'string' && Number.isInteger(v.handle)

const STYLED = new Set(['Box', 'Text', 'div', 'span', 'b'])
/** Each element's props as the renderer reads them; anything else would throw mid-render. */
const PROPS: Record<string, (p: Props, el: Props) => boolean> = {
  Button: (p, el) =>
    Object.values(p).every(isPrimitive) && typeof p.key === 'string' && typeof p.label === 'string' && strings(p, 'hotkey') && isPress(el.press) && primitives(el.hover),
  Input: (p, el) => Object.values(p).every(isPrimitive) && typeof p.key === 'string' && strings(p, 'label', 'placeholder', 'value', 'submitLabel') && isPress(el.press),
  Select: (p, el) =>
    typeof p.key === 'string' && strings(p, 'label', 'value') && isPress(el.press) &&
    Array.isArray(p.options) && p.options.every((o) => isRecord(o) && typeof o.value === 'string' && o.value !== '' && optional(o.label, 'string')),
  Link: (p) => typeof p.href === 'string' && strings(p, 'label'),
  Code: (p) => typeof p.source === 'string' && strings(p, 'language', 'path', 'format', 'wrap') && optional(p.startLine, 'number'),
  Markdown: (p, el) =>
    typeof p.text === 'string' && strings(p, 'key') && optional(p.dimColor, 'boolean') &&
    (p.pressableLinks === undefined || (Array.isArray(p.pressableLinks) && p.pressableLinks.every((l) => typeof l === 'string'))) &&
    (el.press === undefined || isPress(el.press)),
  Svg: (p) => typeof p.source === 'string' && typeof p.alt === 'string' && optional(p.width, 'number') && optional(p.height, 'number'),
  Client: (p, el) =>
    typeof p.key === 'string' && typeof p.module === 'string' && optional(p.flexGrow, 'number') &&
    ['width', 'height'].every((k) => p[k] === undefined || typeof p[k] === 'number' || typeof p[k] === 'string') &&
    isRecord(el.client) && typeof el.client.plugin === 'string',
}

/**
 * Defense in depth: the CLI validated the tree against the surface's element
 * table before sending it, but a `Client` tree comes from plugin code. A view
 * refuses anything it cannot draw safely and draws SuperOne's own component
 * instead.
 */
export function isDrawableModTree(tree: unknown): tree is ModElement {
  let nodes = 0
  const walk = (node: unknown, depth: number): boolean => {
    if (typeof node === 'string') return true
    if (!isRecord(node) || typeof node.type !== 'string') return false
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false
    if (node.type === 'engine') return Number.isInteger(node.ref)
    if (STYLED.has(node.type)) {
      if (!primitives(node.props) || !primitives(node.hover)) return false
    } else {
      const check = Object.hasOwn(PROPS, node.type) ? PROPS[node.type] : undefined
      if (!check || !isRecord(node.props) || !check(node.props, node)) return false
    }
    const children = (node as { children?: unknown }).children
    return children === undefined || (Array.isArray(children) && children.every((c) => walk(c, depth + 1)))
  }
  return walk(tree, 0)
}
