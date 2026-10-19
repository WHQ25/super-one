/** Renderer/store key for a project path that belongs to a remote connection. */
export function remoteProjectKey(connectionId: string, path: string): string {
  return `remote:${connectionId}:${path}`
}

/**
 * Lexical host path: slash direction, `.` / `..`, and a trailing slash.
 * This is not a realpath. A symlink alias is a different string until the node
 * that owns the directory says they are the same file.
 */
export function normalizeHostPath(path: string): string {
  const slash = path.replace(/\\/g, '/')
  const absolute = slash.startsWith('/')
  const parts: string[] = []
  for (const part of slash.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  if (absolute) return `/${parts.join('/')}`
  return parts.join('/') || '.'
}

/** Compare host paths without slash, dot-segment, or trailing-slash differences. */
export function hostPathsEqual(a: string, b: string): boolean {
  return normalizeHostPath(a) === normalizeHostPath(b)
}

/**
 * Directory the file tree and git IPC should read.
 * A remote project's worktree stays `remote:<connectionId>:<hostPath>`. A cwd
 * that is the project root (slash differences included) stays the project key,
 * so a bare host path never falls through to this machine's disk.
 */
export function remoteActiveFileRoot(projectKey: string, activePath: string | null | undefined): string {
  if (!activePath) return projectKey
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) return activePath
  const parsed = parseRemoteProjectKey(activePath)
  const hostPath = normalizeHostPath(parsed?.path ?? activePath)
  if (hostPath === normalizeHostPath(remote.path)) return projectKey
  return remoteProjectKey(parsed?.connectionId ?? remote.connectionId, hostPath)
}

export function parseRemoteProjectKey(key: string): { connectionId: string; path: string } | null {
  if (!key.startsWith('remote:')) return null
  const rest = key.slice('remote:'.length)
  const separator = rest.indexOf(':')
  if (separator <= 0) return null
  return {
    connectionId: rest.slice(0, separator),
    path: rest.slice(separator + 1),
  }
}

/** Renderer-only layout ownership; local ids retain their existing keys. */
export function remoteSessionKey(connectionId: string, sessionId: string): string {
  return `remote-session:${connectionId}:${sessionId}`
}

export function projectSessionKey(projectPath: string | null | undefined, sessionId: string): string {
  const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
  return remote ? remoteSessionKey(remote.connectionId, sessionId) : sessionId
}

export function displayHostPath(keyOrPath: string): string {
  return parseRemoteProjectKey(keyOrPath)?.path ?? keyOrPath
}

export function projectBelongsToHost(projectPath: string | null | undefined, connectionId: string): boolean {
  if (!projectPath) return true
  const remote = parseRemoteProjectKey(projectPath)
  if (connectionId === 'local') return remote === null
  return remote?.connectionId === connectionId
}

/**
 * A remote terminal's `ownerDeviceId` on a controller desktop once the node's
 * own window took the terminal back from it (the node reports its window as
 * no owner, which also means nobody holds it).
 */
export const NODE_WINDOW_TERMINAL_OWNER = 'local'

export function remoteTerminalKey(connectionId: string, terminalId: string): string {
  return `remote-terminal:${connectionId}:${terminalId}`
}

export function parseRemoteTerminalKey(key: string): { connectionId: string; terminalId: string } | null {
  if (!key.startsWith('remote-terminal:')) return null
  const rest = key.slice('remote-terminal:'.length)
  const separator = rest.indexOf(':')
  if (separator <= 0 || separator === rest.length - 1) return null
  return {
    connectionId: rest.slice(0, separator),
    terminalId: rest.slice(separator + 1),
  }
}
