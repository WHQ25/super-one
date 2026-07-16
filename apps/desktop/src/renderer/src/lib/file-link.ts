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

export function resolveProjectFileHref(
  rawHref: string,
  projectRoot: string,
): { filePath: string; lineNumber?: number } | null {
  if (!rawHref || !projectRoot) return null

  let href: string
  try {
    href = decodeURIComponent(rawHref)
  } catch {
    href = rawHref
  }

  let forcedProjectRelative = false

  try {
    const url = new URL(href)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        href = url.pathname + url.search + url.hash
        forcedProjectRelative = true
      } else {
        return null
      }
    } else if (url.protocol === 'file:') {
      href = decodeURIComponent(url.pathname)
    } else {
      return null
    }
  } catch {
  }

  const { filePath, lineNumber } = parseFileLinkTarget(href)

  if (filePath === projectRoot || filePath.startsWith(projectRoot + '/')) {
    return { filePath, lineNumber }
  }

  if (!filePath.startsWith('/') || forcedProjectRelative) {
    const relative = filePath.replace(/^\//, '').replace(/^\.\//, '')
    if (!relative) return null
    return { filePath: `${projectRoot}/${relative}`, lineNumber }
  }

  return null
}

export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}
