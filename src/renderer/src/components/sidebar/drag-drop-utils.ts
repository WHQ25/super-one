export type DropAction = 'move' | 'copy'

export function getDropAction(isInternal: boolean, altKey: boolean): DropAction {
  if (isInternal) return 'move'
  return altKey ? 'move' : 'copy'
}

export function getTargetDir(path: string, isDirectory: boolean): string {
  if (isDirectory) return path
  const lastSlash = path.lastIndexOf('/')
  return lastSlash > 0 ? path.substring(0, lastSlash) : ''
}

export function isChildPath(parentPath: string, childPath: string): boolean {
  return childPath.startsWith(parentPath + '/')
}

export function shouldCollapseAutoExpanded(dir: string, dragOverPath: string | null): boolean {
  return dragOverPath !== dir && !dragOverPath?.startsWith(dir + '/')
}

export function computeDropOverlay(
  dragOverPath: string | null,
  visiblePaths: string[],
  rowHeight: number,
): { top: number; height: number } | null {
  if (!dragOverPath) return null
  let startIdx = -1
  let endIdx = -1
  for (let i = 0; i < visiblePaths.length; i++) {
    const p = visiblePaths[i]
    if (p === dragOverPath || p.startsWith(dragOverPath + '/')) {
      if (startIdx === -1) startIdx = i
      endIdx = i
    }
  }
  if (startIdx === -1) return null
  return { top: startIdx * rowHeight, height: (endIdx - startIdx + 1) * rowHeight }
}
