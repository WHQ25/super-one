export function parseFileLinkTarget(target: string): { filePath: string; lineNumber?: number } {
  const hashMatch = target.match(/^(.*)#L(\d+)$/)
  if (hashMatch) {
    return {
      filePath: hashMatch[1],
      lineNumber: Number.parseInt(hashMatch[2], 10),
    }
  }

  const colonMatch = target.match(/^(.*):(\d+)$/)
  if (colonMatch) {
    return {
      filePath: colonMatch[1],
      lineNumber: Number.parseInt(colonMatch[2], 10),
    }
  }

  return { filePath: target }
}

export function normalizeFileLinkTarget(target: string): string {
  return parseFileLinkTarget(target).filePath
}

export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}
