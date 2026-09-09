export type MobileRoute =
  | 'pair'
  | 'chat'
  /** Global session search, opened from the workspace drawer. */
  | 'session-search'
  /** Pick which project the next session runs in. */
  | 'project-picker'
  /** Add a project to the host — the desktop Add Project flow. */
  | 'add-project'
  | 'terminal'
  | 'worktree'
  | 'branch'
  /** The folders a session gets beyond its project root. */
  | 'add-dir'
  /** A project file opened from a transcript chip — the desktop's file tab. */
  | 'file-preview'
  | 'settings'
  | 'files'

/** Where the Files browser was entered from; it is reachable from both. */
export type FilesOrigin = 'settings' | 'session'

/** Preserve mounted scenes in the shared stack prefix when changing pages. */
export function reconcileRoutes(
  names: MobileRoute[],
  current: readonly { name: string; key: string }[],
): { name: MobileRoute; key?: string }[] {
  let sharedPrefix = true
  return names.map((name, index) => {
    const previous = current[index]
    sharedPrefix = sharedPrefix && previous?.name === name
    return sharedPrefix ? { name, key: previous.key } : { name }
  })
}

/**
 * The stack under a route. Projects and sessions are not screens: the workspace
 * drawer owns both lists, the way the desktop sidebar does, so chat sits
 * directly on the device list.
 */
export function routeHierarchy(
  route: MobileRoute,
  filesOrigin: FilesOrigin = 'settings',
): MobileRoute[] {
  const root: MobileRoute[] = ['pair']
  if (route === 'pair') return root
  root.push('chat')
  if (route === 'chat') return root
  if (route === 'session-search') return [...root, 'session-search']
  if (route === 'terminal') return [...root, 'terminal']
  if (route === 'worktree') return [...root, 'worktree']
  if (route === 'branch') return [...root, 'branch']
  // Opened from the composer — the chip row or `/add-dir` — so back lands on
  // the chat that asked for it, never on a screen the user skipped past.
  if (route === 'add-dir') return [...root, 'add-dir']
  // Opened from a chip in the transcript, so back returns to the reading position.
  if (route === 'file-preview') return [...root, 'file-preview']
  if (route === 'project-picker') return [...root, 'project-picker']
  // Adding always happens on top of the picker it was opened from.
  if (route === 'add-project') return [...root, 'project-picker', 'add-project']
  // Opened from the session menu, Files is a peer of settings, not a child of it —
  // back has to land on the chat the user was reading, not on a screen they skipped.
  if (route === 'files' && filesOrigin === 'session') return [...root, 'files']
  root.push('settings')
  if (route === 'settings') return root
  return [...root, 'files']
}
