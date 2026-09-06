export type MobileRoute =
  | 'pair'
  | 'projects'
  | 'sessions'
  | 'chat'
  /** Pick or add the project a new session runs in. */
  | 'project-picker'
  | 'terminal'
  | 'worktree'
  | 'branch'
  | 'settings'
  | 'files'

export function routeHierarchy(route: MobileRoute, auxiliaryReturn: 'sessions' | 'chat'): MobileRoute[] {
  const root: MobileRoute[] = ['pair']
  if (route === 'pair') return root
  root.push('projects')
  if (route === 'projects') return root
  root.push('sessions')
  if (route === 'sessions') return root
  // The project, worktree and branch pickers are only ever opened from a chat.
  const overChat = route === 'chat' || route === 'terminal' || route === 'worktree'
    || route === 'branch' || route === 'project-picker'
  if (overChat || auxiliaryReturn === 'chat') root.push('chat')
  if (route === 'chat') return root
  if (route === 'terminal') return [...root, 'terminal']
  if (route === 'worktree') return [...root, 'worktree']
  if (route === 'branch') return [...root, 'branch']
  if (route === 'project-picker') return [...root, 'project-picker']
  root.push('settings')
  if (route === 'settings') return root
  return [...root, 'files']
}
