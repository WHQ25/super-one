export type DropAction = 'move' | 'copy'

export const internalDragSource = { active: false, lastEndMs: 0 }

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

export function isWithinFolder(absolutePath: string, folder: string): boolean {
  if (absolutePath === folder) return true
  const base = folder.endsWith('/') ? folder : folder + '/'
  return absolutePath.startsWith(base)
}

export function toAbsolutePath(folder: string, relativePath: string): string {
  if (relativePath === '' || relativePath === '.') return folder
  if (relativePath.startsWith('/')) return relativePath
  return folder.endsWith('/') ? folder + relativePath : folder + '/' + relativePath
}

/** Label for the folder a drop would land in — the project root when nothing specific is hovered. */
export function getDropTargetName(dragOverPath: string | null, rootName: string): string {
  if (!dragOverPath) return rootName
  const lastSlash = dragOverPath.lastIndexOf('/')
  return lastSlash >= 0 ? dragOverPath.slice(lastSlash + 1) : dragOverPath
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
