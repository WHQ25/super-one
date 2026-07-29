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
    const copy: UiOutlineNode = {
      ref: node.ref,
      role: node.role,
      name: node.name,
      value: node.value,
      bounds: node.bounds ? { ...node.bounds } : undefined,
      enabled: node.enabled,
      focused: node.focused,
      pictureOnly: node.pictureOnly,
      capabilities: node.capabilities ? { ...node.capabilities } : undefined,
    }
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
  const copy: UiOutlineNode = {
    ref: node.ref,
    role: node.role,
    name: node.name,
    value: node.value,
    bounds: node.bounds ? { ...node.bounds } : undefined,
    enabled: node.enabled,
    focused: node.focused,
    pictureOnly: node.pictureOnly,
    capabilities: node.capabilities ? { ...node.capabilities } : undefined,
  }
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

/** Structural diff of two outlines by ref identity. */
export function diffOutlines(
  before: UiOutlineNode,
  after: UiOutlineNode,
): { added: string[]; removed: string[]; changed: Array<{ ref: string; field: string; from?: string; to?: string }> } {
  const beforeMap = new Map<string, UiOutlineNode>()
  const afterMap = new Map<string, UiOutlineNode>()
  indexNodes(before, beforeMap)
  indexNodes(after, afterMap)

  const added: string[] = []
  const removed: string[] = []
  const changed: Array<{ ref: string; field: string; from?: string; to?: string }> = []

  for (const ref of afterMap.keys()) {
    if (!beforeMap.has(ref)) added.push(ref)
  }
  for (const ref of beforeMap.keys()) {
    if (!afterMap.has(ref)) removed.push(ref)
  }
  for (const [ref, a] of afterMap) {
    const b = beforeMap.get(ref)
    if (!b) continue
    if ((b.name ?? '') !== (a.name ?? '')) {
      changed.push({ ref, field: 'name', from: b.name, to: a.name })
    }
    if ((b.value ?? '') !== (a.value ?? '')) {
      changed.push({ ref, field: 'value', from: b.value, to: a.value })
    }
    if ((b.enabled ?? true) !== (a.enabled ?? true)) {
      changed.push({
        ref,
        field: 'enabled',
        from: String(b.enabled ?? true),
        to: String(a.enabled ?? true),
      })
    }
  }

  return { added, removed, changed }
}

function indexNodes(node: UiOutlineNode, map: Map<string, UiOutlineNode>): void {
  map.set(node.ref, node)
  for (const c of node.children ?? []) indexNodes(c, map)
}
