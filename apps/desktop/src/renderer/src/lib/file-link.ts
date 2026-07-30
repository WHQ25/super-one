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

  try {
    const url = new URL(href)
    // Network URLs are never project files — not even localhost.
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return null
    }
    if (url.protocol === 'file:') {
      href = decodeURIComponent(url.pathname)
      // Windows file URLs look like file:///C:/Users/... → pathname /C:/Users/...
      if (/^\/[A-Za-z]:\//.test(href)) href = href.slice(1)
    } else {
      // mailto:, javascript:, data:, etc.
      return null
    }
  } catch {
    // Not an absolute URL — treat as a filesystem path (absolute or project-relative).
  }

  const { filePath, lineNumber } = parseFileLinkTarget(href)

  if (filePath === projectRoot || filePath.startsWith(projectRoot + '/')) {
    return { filePath, lineNumber }
  }

  // Project-relative (including ./prefix). Absolute paths outside the project root
  // are rejected above/below — never invent a project path from an http origin.
  const isWindowsAbs = /^[A-Za-z]:[\\/]/.test(filePath)
  if (!filePath.startsWith('/') && !isWindowsAbs) {
    const relative = filePath.replace(/^\.\//, '')
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
