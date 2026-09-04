export type RemoteDirectoryEntry = { name: string; isDirectory: boolean }
export type RemoteDirectoryAction = { kind: 'directory' | 'file'; path: string }

export function joinRemotePath(parent: string, name: string): string {
  const base = parent.replace(/\\/g, '/').replace(/\/+$/, '')
  const child = name.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${base || ''}/${child}`
}

export function parentRemotePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = slashed.match(/^([A-Za-z]:)(?:\/|$)/)?.[1]
  const uncRoot = slashed.match(/^(\/\/[^/]+\/[^/]+)/)?.[1]
  if (drive && slashed.replace(/\/+$/, '') === drive) return `${drive}/`
  if (uncRoot && slashed.replace(/\/+$/, '') === uncRoot) return uncRoot
  const normalized = slashed.replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  if (drive && slash <= drive.length) return `${drive}/`
  if (uncRoot && slash <= uncRoot.length) return uncRoot
  if (slash <= 0) return '/'
  return normalized.slice(0, slash)
}

export function resolveRemoteFilePath(projectPath: string, filePath: string): string {
  const absolute = filePath.startsWith('/')
    || filePath.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(filePath)
  return absolute ? filePath : joinRemotePath(projectPath, filePath)
}

export function directoryEntryAction(parent: string, entry: RemoteDirectoryEntry): RemoteDirectoryAction {
  return {
    kind: entry.isDirectory ? 'directory' : 'file',
    path: joinRemotePath(parent, entry.name),
  }
}
