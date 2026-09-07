import { describe, expect, it } from 'vitest'
import { routeHierarchy } from './route-state'

describe('routeHierarchy', () => {
  it('stacks chat directly on the device list', () => {
    expect(routeHierarchy('pair')).toEqual(['pair'])
    expect(routeHierarchy('chat')).toEqual(['pair', 'chat'])
    expect(routeHierarchy('terminal')).toEqual(['pair', 'chat', 'terminal'])
    expect(routeHierarchy('session-search')).toEqual(['pair', 'chat', 'session-search'])
  })

  it('opens the git pickers over the chat they were started from', () => {
    expect(routeHierarchy('worktree')).toEqual(['pair', 'chat', 'worktree'])
    expect(routeHierarchy('branch')).toEqual(['pair', 'chat', 'branch'])
  })

  it('puts add-project on top of the picker it starts from', () => {
    expect(routeHierarchy('project-picker')).toEqual(['pair', 'chat', 'project-picker'])
    expect(routeHierarchy('add-project')).toEqual(['pair', 'chat', 'project-picker', 'add-project'])
  })

  it('nests settings and the files browser under the chat', () => {
    expect(routeHierarchy('settings')).toEqual(['pair', 'chat', 'settings'])
    expect(routeHierarchy('files')).toEqual(['pair', 'chat', 'settings', 'files'])
  })

  it('drops settings from the files stack when the session menu opened it', () => {
    expect(routeHierarchy('files', 'session')).toEqual(['pair', 'chat', 'files'])
  })
})
