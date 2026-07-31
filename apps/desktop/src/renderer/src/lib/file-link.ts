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

export function isAbsoluteLocalPath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

/**
 * Resolve a markdown href into a local filesystem path (+ optional line).
 * - http(s) / mailto / etc. → null (browser links)
 * - absolute paths and file:// → always a file (in- or out-of-project)
 * - relative paths → joined to projectRoot (requires projectRoot)
 */
export function resolveProjectFileHref(
  rawHref: string,
  projectRoot: string,
): { filePath: string; lineNumber?: number } | null {
  if (!rawHref) return null

  let href: string
  try {
    href = decodeURIComponent(rawHref)
  } catch {
    href = rawHref
  }

  // Drive-letter paths must not go through URL() — "C:\foo" is parsed as scheme "c:".
  if (!/^[A-Za-z]:[\\/]/.test(href)) {
    try {
      const url = new URL(href)
      // Network URLs are never project files — not even localhost.
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return null
      }
      if (url.protocol === 'file:' || url.protocol === 'local-file:') {
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
  }

  const { filePath, lineNumber } = parseFileLinkTarget(href)

  // Absolute local paths open in the editor whether or not they sit under the
  // current project (e.g. dependency source in another clone).
  if (isAbsoluteLocalPath(filePath)) {
    return { filePath, lineNumber }
  }

  // Project-relative (including ./prefix). Never invent a path without a root.
  if (!projectRoot) return null
  const relative = filePath.replace(/^\.\//, '')
  if (!relative) return null
  return { filePath: `${projectRoot}/${relative}`, lineNumber }
}

export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}
