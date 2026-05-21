import type { FileSearchResult } from '@superone/shared/agent-types'

export interface FlatSearchNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  matchIndices: number[]
}

interface BuiltNode {
  name: string
  isDirectory: boolean
  matchIndices: Set<number>
}

export function buildSearchTree(results: FileSearchResult[]): FlatSearchNode[] {
  const nodeMap = new Map<string, BuiltNode>()

  for (const result of results) {
    const parts = result.path.split('/')
    let acc = ''
    let segStart = 0
    for (let k = 0; k < parts.length; k++) {
      const name = parts[k]
      acc = acc ? `${acc}/${name}` : name
      const isDirectory = k < parts.length - 1 ? true : result.isDirectory
      let node = nodeMap.get(acc)
      if (!node) {
        node = { name, isDirectory, matchIndices: new Set() }
        nodeMap.set(acc, node)
      }
      for (const idx of result.matchIndices) {
        if (idx >= segStart && idx < segStart + name.length) {
          node.matchIndices.add(idx - segStart)
        }
      }
      segStart += name.length + 1
    }
  }

  const childrenMap = new Map<string, string[]>()
  for (const path of nodeMap.keys()) {
    const slash = path.lastIndexOf('/')
    const parent = slash >= 0 ? path.slice(0, slash) : ''
    const list = childrenMap.get(parent)
    if (list) list.push(path)
    else childrenMap.set(parent, [path])
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      const na = nodeMap.get(a)!
      const nb = nodeMap.get(b)!
      if (na.isDirectory !== nb.isDirectory) return na.isDirectory ? -1 : 1
      return na.name.localeCompare(nb.name)
    })
  }

  const flat: FlatSearchNode[] = []
  const walk = (parent: string, depth: number): void => {
    const children = childrenMap.get(parent)
    if (!children) return
    for (const path of children) {
      const node = nodeMap.get(path)!
      flat.push({
        path,
        name: node.name,
        isDirectory: node.isDirectory,
        depth,
        matchIndices: [...node.matchIndices].sort((a, b) => a - b),
      })
      walk(path, depth + 1)
    }
  }
  walk('', 0)
  return flat
}
