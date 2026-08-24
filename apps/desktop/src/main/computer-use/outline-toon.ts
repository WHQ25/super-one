import { encode as toonEncode } from '@toon-format/toon'
import type { UiOutlineNode } from './types'

/**
 * Render an outline as a TOON table for the model-facing reply.
 *
 * Nested JSON spends ~278 bytes per node, and most of it says nothing: a
 * `capabilities` object whose five booleans are usually all false, plus
 * `enabled: true` / `focused: false` / `pictureOnly: false` defaults. Flattening
 * to one row per node and listing only the capabilities that are true costs
 * ~42 bytes instead — the same shape `browser_snapshot` and `computer_apps`
 * already return, so the model sees one table convention across the tool set.
 *
 * Nesting survives as the `depth` column rather than as indentation, which is
 * what makes the rows uniform enough for TOON to pay off at all.
 */

/** Order is stable so the `can` column reads the same way across snapshots. */
const CAPABILITY_KEYS = ['press', 'setText', 'typeText', 'scroll', 'focus'] as const

interface OutlineRow {
  ref: string
  depth: number
  role: string
  name: string
  value: string
  /** Empty when the node reports no frame — never 0, which is a real coordinate. */
  x: number | ''
  y: number | ''
  w: number | ''
  h: number | ''
  /** Pipe-joined because TOON separates columns with commas. */
  can: string
  /** Only the non-default states; empty for the overwhelming majority of nodes. */
  state: string
}

function capabilityList(node: UiOutlineNode): string {
  const caps = node.capabilities
  if (!caps) return ''
  return CAPABILITY_KEYS.filter((key) => caps[key]).join('|')
}

function stateList(node: UiOutlineNode): string {
  const flags: string[] = []
  if (node.enabled === false) flags.push('disabled')
  if (node.focused) flags.push('focused')
  return flags.join('|')
}

function toRow(node: UiOutlineNode, depth: number): OutlineRow {
  const bounds = node.bounds
  return {
    ref: node.ref,
    depth,
    role: node.role,
    name: node.name ?? '',
    value: node.value ?? '',
    x: bounds ? Math.round(bounds.x) : '',
    y: bounds ? Math.round(bounds.y) : '',
    w: bounds ? Math.round(bounds.width) : '',
    h: bounds ? Math.round(bounds.height) : '',
    can: capabilityList(node),
    state: stateList(node),
  }
}

/** Flatten depth-first so row order still reads as the tree's reading order. */
export function outlineToRows(root: UiOutlineNode): OutlineRow[] {
  const rows: OutlineRow[] = []
  const walk = (node: UiOutlineNode, depth: number): void => {
    rows.push(toRow(node, depth))
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(root, 0)
  return rows
}

export function outlineToToon(root: UiOutlineNode): string {
  return toonEncode({ outline: outlineToRows(root) })
}
