import {
  DEFAULT_FOLD_DEPTH,
  DEFAULT_FOLD_MAX_NODES,
  type UiOutlineNode,
} from './types'

export interface FoldOptions {
  maxDepth?: number
  maxNodes?: number
}

export interface FoldResult {
  outline: UiOutlineNode
  nodesOmitted: number
  maxDepth: number
}

/** Deep-clone and fold a complete outline for model-facing return. */
export function foldOutline(root: UiOutlineNode, options: FoldOptions = {}): FoldResult {
  const maxDepth = options.maxDepth ?? DEFAULT_FOLD_DEPTH
  const maxNodes = options.maxNodes ?? DEFAULT_FOLD_MAX_NODES
  let nodesSeen = 0
  let nodesOmitted = 0

  function walk(node: UiOutlineNode, depth: number): UiOutlineNode | null {
    if (nodesSeen >= maxNodes) {
      nodesOmitted += 1 + countDescendants(node)
      return null
    }
    nodesSeen += 1
    const copy = cloneNode(node)
    if (depth >= maxDepth || !node.children?.length) {
      if (node.children?.length) {
        nodesOmitted += node.children.reduce((n, c) => n + 1 + countDescendants(c), 0)
      }
      return copy
    }
    const kids: UiOutlineNode[] = []
    for (const child of node.children) {
      const c = walk(child, depth + 1)
      if (c) kids.push(c)
    }
    if (kids.length) copy.children = kids
    return copy
  }

  const outline = walk(root, 0) ?? { ref: root.ref, role: root.role, name: root.name }
  return { outline, nodesOmitted, maxDepth }
}

export function countDescendants(node: UiOutlineNode): number {
  if (!node.children?.length) return 0
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0)
}

export function findNode(root: UiOutlineNode, ref: string): UiOutlineNode | undefined {
  if (root.ref === ref) return root
  for (const child of root.children ?? []) {
    const hit = findNode(child, ref)
    if (hit) return hit
  }
  return undefined
}

export function expandSubtree(
  root: UiOutlineNode,
  ref: string,
  depth: number,
): UiOutlineNode | undefined {
  const node = findNode(root, ref)
  if (!node) return undefined
  return cloneToDepth(node, depth)
}

function cloneToDepth(node: UiOutlineNode, depth: number): UiOutlineNode {
  const copy = cloneNode(node)
  if (depth > 0 && node.children?.length) {
    copy.children = node.children.map((c) => cloneToDepth(c, depth - 1))
  }
  return copy
}

export interface SearchHit {
  ref: string
  role: string
  name?: string
  value?: string
  path: string[]
}

export function searchOutline(
  root: UiOutlineNode,
  text: string,
  limit = 20,
): SearchHit[] {
  const q = text.toLowerCase()
  const exact: SearchHit[] = []
  const prefix: SearchHit[] = []
  const substr: SearchHit[] = []

  function walk(node: UiOutlineNode, path: string[]): void {
    const name = node.name ?? ''
    const value = node.value ?? ''
    const fields = [name, value, node.role].map((s) => s.toLowerCase())
    const hit: SearchHit = {
      ref: node.ref,
      role: node.role,
      name: node.name,
      value: node.value,
      path: [...path, node.ref],
    }
    if (fields.some((f) => f === q)) exact.push(hit)
    else if (fields.some((f) => f.startsWith(q))) prefix.push(hit)
    else if (fields.some((f) => f.includes(q))) substr.push(hit)

    for (const child of node.children ?? []) walk(child, hit.path)
  }

  walk(root, [])
  return [...exact, ...prefix, ...substr].slice(0, limit)
}

/** Collect all refs in preorder. */
export function collectRefs(root: UiOutlineNode): string[] {
  const out: string[] = [root.ref]
  for (const c of root.children ?? []) out.push(...collectRefs(c))
  return out
}

/**
 * Diff two outlines by what each node is, not by where it came in the walk.
 *
 * A ref is a preorder index, so one node appearing early — the "Edited"
 * label a title bar gains on the first keystroke — moves every ref after it
 * by one, and a ref-keyed diff then reported the whole menu bar as changed:
 * "@e49 name from Apple", "@e50 name to Apple"… hundreds of entries, the
 * one real change buried, and an act that did nothing judged to have worked
 * by their count. Nodes are paired instead under their paired parent, first
 * by role and name in sibling order, then whatever is left by role alone in
 * sibling order (a label whose text changed), and only the remainder is
 * added or removed. Refs in the result are the successor's, which is the
 * state the caller acts on next. `stable` counts the pairs that read the
 * same on both sides: when almost none do, the window's content has been
 * replaced and the diff is a rewrite, not a report.
 */
export function diffOutlines(
  before: UiOutlineNode,
  after: UiOutlineNode,
): { added: string[]; removed: string[]; changed: Array<{ ref: string; field: string; from?: string; to?: string }>; stable: number } {
  const added: string[] = []
  const removed: string[] = []
  const changed: Array<{ ref: string; field: string; from?: string; to?: string }> = []
  /** Paired nodes that read the same on both sides. */
  let stable = 0

  const compare = (b: UiOutlineNode, a: UiOutlineNode) => {
    const seen = changed.length
    if ((b.name ?? '') !== (a.name ?? '')) changed.push({ ref: a.ref, field: 'name', from: b.name, to: a.name })
    if ((b.value ?? '') !== (a.value ?? '')) changed.push({ ref: a.ref, field: 'value', from: b.value, to: a.value })
    if ((b.enabled ?? true) !== (a.enabled ?? true)) {
      changed.push({ ref: a.ref, field: 'enabled', from: String(b.enabled ?? true), to: String(a.enabled ?? true) })
    }
    if ((b.selected ?? false) !== (a.selected ?? false)) {
      changed.push({ ref: a.ref, field: 'selected', from: String(b.selected ?? false), to: String(a.selected ?? false) })
    }
    if (changed.length === seen) stable += 1
    pairChildren(b.children ?? [], a.children ?? [])
  }

  const pairChildren = (befores: UiOutlineNode[], afters: UiOutlineNode[]) => {
    const pairs: Array<[UiOutlineNode, UiOutlineNode]> = []
    let leftB = befores
    let leftA = afters
    for (const key of [(n: UiOutlineNode) => `${n.role}\u0000${n.name ?? ''}`, (n: UiOutlineNode) => n.role]) {
      const queue = new Map<string, UiOutlineNode[]>()
      for (const b of leftB) {
        const k = key(b)
        queue.set(k, [...(queue.get(k) ?? []), b])
      }
      const unpairedA: UiOutlineNode[] = []
      for (const a of leftA) {
        const b = queue.get(key(a))?.shift()
        if (b) pairs.push([b, a])
        else unpairedA.push(a)
      }
      leftB = [...queue.values()].flat()
      leftA = unpairedA
    }
    for (const b of leftB) removed.push(...collectRefs(b))
    for (const a of leftA) added.push(...collectRefs(a))
    for (const [b, a] of pairs) compare(b, a)
  }

  if (before.role === after.role) compare(before, after)
  else {
    removed.push(...collectRefs(before))
    added.push(...collectRefs(after))
  }
  // In outline order, so the window's content reads before its menus.
  const order = (ref: string) => Number(ref.replace(/\D/g, '')) || 0
  changed.sort((x, y) => order(x.ref) - order(y.ref))
  return { added: added.sort((x, y) => order(x) - order(y)), removed: removed.sort((x, y) => order(x) - order(y)), changed, stable }
}

/** Clone all semantic identity and capability fields while folding children separately. */
function cloneNode(node: UiOutlineNode): UiOutlineNode {
  const { children: _children, ...fields } = node
  return { ...fields,
    bounds: node.bounds ? { ...node.bounds } : undefined,
    capabilities: node.capabilities ? { ...node.capabilities } : undefined,
    ...(node.nativeTarget ? { nativeTarget: { ...node.nativeTarget } } : {}),
  }
}
