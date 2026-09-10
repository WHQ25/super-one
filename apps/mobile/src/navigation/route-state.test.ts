import { describe, expect, it } from 'vitest'
import { reconcileRoutes, routeHierarchy } from './route-state'

describe('reconcileRoutes', () => {
  const chat = [{ name: 'pair', key: 'device-1' }, { name: 'chat', key: 'chat-1' }]

  it('keeps the chat WebView mounted when opening and closing terminal', () => {
    expect(reconcileRoutes(routeHierarchy('terminal'), chat)).toEqual([
      ...chat, { name: 'terminal' },
    ])
    expect(reconcileRoutes(routeHierarchy('chat'), [
      ...chat, { name: 'terminal', key: 'terminal-1' },
    ])).toEqual(chat)
  })

  it('preserves the chat when switching detail pages', () => {
    expect(reconcileRoutes(routeHierarchy('settings'), [
      ...chat, { name: 'terminal', key: 'terminal-1' },
    ])).toEqual([...chat, { name: 'settings' }])
  })

  it('creates a fresh scene when its parent hierarchy changes', () => {
    expect(reconcileRoutes(routeHierarchy('files', 'session'), [
      ...chat, { name: 'settings', key: 'settings-1' }, { name: 'files', key: 'files-1' },
    ])).toEqual([...chat, { name: 'files' }])
  })

  it('discards chat on disconnect', () => {
    expect(reconcileRoutes(routeHierarchy('pair'), chat)).toEqual([chat[0]])
  })
})

describe('routeHierarchy', () => {
  it('stacks chat directly on the device list', () => {
    expect(routeHierarchy('pair')).toEqual(['pair'])
    expect(routeHierarchy('chat')).toEqual(['pair', 'chat'])
    expect(routeHierarchy('terminal')).toEqual(['pair', 'chat', 'terminal'])
    expect(routeHierarchy('session-search')).toEqual(['pair', 'chat', 'session-search'])
  })

  it('opens additional folders on the chat that asked for it', () => {
    // The chip row and `/add-dir` both sit on the composer, so back has to land
    // on that conversation rather than on settings the user never opened.
    expect(routeHierarchy('add-dir')).toEqual(['pair', 'chat', 'add-dir'])
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
