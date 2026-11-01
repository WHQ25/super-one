import { beforeEach, describe, expect, it } from 'vitest'
import {
  applySidebarFocus,
  focusBack,
  focusEnvironment,
  focusProject,
  focusSession,
  sidebarFocusCrumbs,
  useSidebarFocusStore,
} from './sidebar-focus'

describe('sidebar focus', () => {
  beforeEach(() => {
    useSidebarFocusStore.setState({ target: null })
  })

  it('steps from a parent session back to its project, then out', () => {
    focusSession('/repo', 'parent')
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'session',
      folderPath: '/repo',
      sessionId: 'parent',
      environmentId: null,
    })
    focusBack()
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project',
      folderPath: '/repo',
      environmentId: null,
    })
    focusBack()
    expect(useSidebarFocusStore.getState().target).toBeNull()
  })

  it('keeps the environment when a project inside it is focused', () => {
    focusEnvironment('env-1')
    focusProject('/repo')
    focusSession('/repo', 'parent')
    focusBack()
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project',
      folderPath: '/repo',
      environmentId: 'env-1',
    })
    focusBack()
    expect(useSidebarFocusStore.getState().target).toEqual({ kind: 'environment', environmentId: 'env-1' })
    focusBack()
    expect(useSidebarFocusStore.getState().target).toBeNull()
  })

  it('does not inherit an environment when the project row says there is none', () => {
    focusEnvironment('env-1')
    focusProject('/repo', null)
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project',
      folderPath: '/repo',
      environmentId: null,
    })
  })

  it('does not inherit an environment when the session row says there is none', () => {
    focusEnvironment('env-1')
    focusSession('/repo', 'parent', null)
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'session',
      folderPath: '/repo',
      sessionId: 'parent',
      environmentId: null,
    })
  })

  it('jumps to the crumb that was selected', () => {
    focusSession('/repo', 'parent', 'env-1')
    const crumbs = sidebarFocusCrumbs(useSidebarFocusStore.getState().target!, {
      root: 'All',
      environment: 'Build box',
      project: 'super-one',
      session: 'Parent',
    })
    expect(crumbs.map((crumb) => crumb.id)).toEqual(['root', 'environment', 'project', 'session'])
    expect(crumbs[3]?.current).toBe(true)
    applySidebarFocus(crumbs[1]!.target)
    expect(useSidebarFocusStore.getState().target).toEqual({ kind: 'environment', environmentId: 'env-1' })
    applySidebarFocus(crumbs[0]!.target)
    expect(useSidebarFocusStore.getState().target).toBeNull()
  })

  it('omits the environment crumb when the project has none', () => {
    const crumbs = sidebarFocusCrumbs(
      { kind: 'project', folderPath: '/repo', environmentId: null },
      { root: 'All', project: 'super-one' },
    )
    expect(crumbs.map((crumb) => [crumb.id, crumb.label, crumb.current])).toEqual([
      ['root', 'All', false],
      ['project', 'super-one', true],
    ])
  })
})
