import { describe, expect, it } from 'vitest'
import { routeHierarchy } from './route-state'

describe('mobile route hierarchy', () => {
  it('builds the primary phone navigation stack', () => {
    expect(routeHierarchy('pair', 'sessions')).toEqual(['pair'])
    expect(routeHierarchy('projects', 'sessions')).toEqual(['pair', 'projects'])
    expect(routeHierarchy('sessions', 'sessions')).toEqual(['pair', 'projects', 'sessions'])
    expect(routeHierarchy('chat', 'sessions')).toEqual(['pair', 'projects', 'sessions', 'chat'])
    expect(routeHierarchy('terminal', 'chat')).toEqual(['pair', 'projects', 'sessions', 'chat', 'terminal'])
  })

  it('returns settings and files to the owning sessions or chat route', () => {
    expect(routeHierarchy('settings', 'sessions')).toEqual(['pair', 'projects', 'sessions', 'settings'])
    expect(routeHierarchy('settings', 'chat')).toEqual(['pair', 'projects', 'sessions', 'chat', 'settings'])
    expect(routeHierarchy('files', 'chat')).toEqual(['pair', 'projects', 'sessions', 'chat', 'settings', 'files'])
  })
})
