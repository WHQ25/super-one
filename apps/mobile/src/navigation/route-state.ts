export type MobileRoute = 'pair' | 'projects' | 'sessions' | 'chat' | 'terminal' | 'settings' | 'files'

export function routeHierarchy(route: MobileRoute, auxiliaryReturn: 'sessions' | 'chat'): MobileRoute[] {
  const root: MobileRoute[] = ['pair']
  if (route === 'pair') return root
  root.push('projects')
  if (route === 'projects') return root
  root.push('sessions')
  if (route === 'sessions') return root
  if (route === 'chat' || route === 'terminal' || auxiliaryReturn === 'chat') root.push('chat')
  if (route === 'chat') return root
  if (route === 'terminal') return [...root, 'terminal']
  root.push('settings')
  if (route === 'settings') return root
  return [...root, 'files']
}
