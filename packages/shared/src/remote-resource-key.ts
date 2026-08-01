/** Renderer/store key for a project path that belongs to a remote connection. */
export function remoteProjectKey(connectionId: string, path: string): string {
  return `remote:${connectionId}:${path}`
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

export function displayHostPath(keyOrPath: string): string {
  return parseRemoteProjectKey(keyOrPath)?.path ?? keyOrPath
}

export function projectBelongsToHost(projectPath: string | null | undefined, connectionId: string): boolean {
  if (!projectPath) return true
  const remote = parseRemoteProjectKey(projectPath)
  if (connectionId === 'local') return remote === null
  return remote?.connectionId === connectionId
}

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
