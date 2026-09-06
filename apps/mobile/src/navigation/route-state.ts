export type MobileRoute =
  | 'pair'
  | 'projects'
  | 'sessions'
  | 'chat'
  /** Pick which project the next session runs in. */
  | 'project-picker'
  /** Add a project to the host — the desktop Add Project flow. */
  | 'add-project'
  | 'terminal'
  | 'worktree'
  | 'branch'
  | 'settings'
  | 'files'

/** Where the Files browser was entered from; it is reachable from both. */
export type FilesOrigin = 'settings' | 'session'

export function routeHierarchy(
  route: MobileRoute,
  auxiliaryReturn: 'sessions' | 'chat',
  filesOrigin: FilesOrigin = 'settings',
): MobileRoute[] {
  const root: MobileRoute[] = ['pair']
  if (route === 'pair') return root
  root.push('projects')
  if (route === 'projects') return root
  root.push('sessions')
  if (route === 'sessions') return root
  // The project, worktree and branch pickers are only ever opened from a chat.
  const overChat = route === 'chat' || route === 'terminal' || route === 'worktree'
    || route === 'branch' || route === 'project-picker' || route === 'add-project'
  if (overChat || auxiliaryReturn === 'chat') root.push('chat')
  if (route === 'chat') return root
  if (route === 'terminal') return [...root, 'terminal']
  if (route === 'worktree') return [...root, 'worktree']
  if (route === 'branch') return [...root, 'branch']
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
