const HOME_RE = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/

export function shortenPath(absolutePath: string, cwd?: string | null, homedir?: string | null): string {
  if (!absolutePath) return absolutePath

  const candidates: string[] = [absolutePath]

  if (cwd && absolutePath === cwd) {
    candidates.push('.')
  } else if (cwd && absolutePath.startsWith(cwd + '/')) {
    candidates.push(absolutePath.slice(cwd.length + 1))
  }

  if (homedir && absolutePath === homedir) {
    candidates.push('~')
  } else if (homedir && absolutePath.startsWith(homedir + '/')) {
    candidates.push('~/' + absolutePath.slice(homedir.length + 1))
  } else {
    const homeMatch = absolutePath.match(HOME_RE)
    if (homeMatch) {
      candidates.push('~' + absolutePath.slice(homeMatch[0].length))
    }
  }

  return candidates.reduce((a, b) => (a.length <= b.length ? a : b))
}

export function homePath(absolutePath: string): string {
  return absolutePath.replace(HOME_RE, '~')
}

export function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = encodeURI(normalized).replace(/#/g, '%23')
  return /^[A-Za-z]:/.test(normalized)
    ? `local-file:///${encoded}`
    : `local-file://${encoded}`
}

let _mediaServerPort = 0
window.app.getMediaServerPort().then((p) => { _mediaServerPort = p })

export function toMediaUrl(filePath: string): string {
  if (_mediaServerPort) {
    const normalized = filePath.replace(/\\/g, '/')
    return `http://127.0.0.1:${_mediaServerPort}${encodeURI(normalized).replace(/#/g, '%23')}`
  }
  return toLocalFileUrl(filePath)
}
