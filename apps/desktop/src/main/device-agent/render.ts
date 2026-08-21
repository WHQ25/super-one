import type { DeviceUiNode } from '@superone/shared/device-agent'

/**
 * Serialize a tree for the agent.
 *
 * Indented text rather than JSON: a UI tree is nested and irregular, which is the
 * shape TOON loses on, and JSON spends most of its bytes on braces, quotes and
 * repeated key names at every one of a few hundred nodes. One line per node with
 * positional fields says the same thing in a fraction of the budget and reads more
 * like something a person could scan.
 *
 * Roles arrive as `AXButton`; the prefix is noise once everything has it.
 */
export function renderTree(
  root: DeviceUiNode,
  options: { maxDepth?: number; markSource?: boolean } = {},
): string {
  const maxDepth = options.maxDepth ?? 32
  // A tree that is entirely recognized text says so once, at the top of the reply.
  // Repeating it on every one of a few hundred nodes buys nothing and costs tokens;
  // on a mixed screen the per-node mark is the only way to tell the halves apart.
  const markSource = options.markSource ?? root.source !== 'ocr'
  const lines: string[] = []

  const walk = (node: DeviceUiNode, depth: number) => {
    if (depth > maxDepth) return
    lines.push('  '.repeat(depth) + renderNode(node, markSource))
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(root, 0)
  return lines.join('\n')
}

export function renderNode(node: DeviceUiNode, markSource = true): string {
  const parts = [node.ref, shortRole(node.role)]
  if (node.label) parts.push(JSON.stringify(node.label))
  if (node.identifier && node.identifier !== node.label) parts.push(`#${node.identifier}`)
  if (node.value) parts.push(`=${JSON.stringify(node.value)}`)
  if (markSource && node.source === 'ocr') parts.push('(ocr)')
  if (node.enabled === false) parts.push('(disabled)')
  if (node.focused) parts.push('(focused)')
  if (node.bounds) {
    const [x, y, width, height] = node.bounds.map((value) => value.toFixed(3))
    parts.push(`[${x},${y} ${width}x${height}]`)
  }
  if (node.truncatedChildren) parts.push(`(+${node.truncatedChildren} more)`)
  return parts.join(' ')
}

function shortRole(role: string): string {
  return role.startsWith('AX') ? role.slice(2).toLowerCase() : role.toLowerCase()
}
