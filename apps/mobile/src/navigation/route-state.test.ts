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

  it('stacks the git pickers on top of the chat they were opened from', () => {
    expect(routeHierarchy('worktree', 'sessions')).toEqual(['pair', 'projects', 'sessions', 'chat', 'worktree'])
    expect(routeHierarchy('branch', 'sessions')).toEqual(['pair', 'projects', 'sessions', 'chat', 'branch'])
  })

  it('stacks adding a project on top of the picker it was opened from', () => {
    expect(routeHierarchy('project-picker', 'sessions'))
      .toEqual(['pair', 'projects', 'sessions', 'chat', 'project-picker'])
    expect(routeHierarchy('add-project', 'sessions'))
      .toEqual(['pair', 'projects', 'sessions', 'chat', 'project-picker', 'add-project'])
  })

  it('returns settings and files to the owning sessions or chat route', () => {
    expect(routeHierarchy('settings', 'sessions')).toEqual(['pair', 'projects', 'sessions', 'settings'])
    expect(routeHierarchy('settings', 'chat')).toEqual(['pair', 'projects', 'sessions', 'chat', 'settings'])
    expect(routeHierarchy('files', 'chat')).toEqual(['pair', 'projects', 'sessions', 'chat', 'settings', 'files'])
  })

  it('drops settings from the stack when files was opened from the session menu', () => {
    expect(routeHierarchy('files', 'chat', 'session'))
      .toEqual(['pair', 'projects', 'sessions', 'chat', 'files'])
    expect(routeHierarchy('files', 'sessions', 'session'))
      .toEqual(['pair', 'projects', 'sessions', 'files'])
  })
})
