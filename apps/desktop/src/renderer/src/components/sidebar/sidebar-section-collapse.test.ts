/** @vitest-environment jsdom */

import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROJECT_SETTLED_COLLAPSE_KEY,
  SIDEBAR_SECTION_COLLAPSE_KEY,
  foldProjectSettled,
  readCollapsedSection,
  readProjectSettledCollapsed,
  useProjectSettledCollapsed,
  useSidebarSectionCollapsed,
  writeCollapsedSection,
  writeProjectSettledCollapsed,
} from './sidebar-section-collapse'

beforeEach(() => localStorage.clear())

describe('sidebar section collapse', () => {
  it('treats a missing or corrupt preference as open', () => {
    expect(readCollapsedSection(localStorage, 'pinned')).toBe(false)
    localStorage.setItem(SIDEBAR_SECTION_COLLAPSE_KEY, '{')
    expect(readCollapsedSection(localStorage, 'drafts')).toBe(false)
    localStorage.setItem(SIDEBAR_SECTION_COLLAPSE_KEY, JSON.stringify(['pinned']))
    expect(readCollapsedSection(localStorage, 'pinned')).toBe(false)
  })

  it('keeps settled folded until that section is opened', () => {
    expect(readCollapsedSection(localStorage, 'settled')).toBe(true)
    expect(readCollapsedSection(localStorage, 'offline')).toBe(true)
    localStorage.setItem(SIDEBAR_SECTION_COLLAPSE_KEY, JSON.stringify({ pinned: true }))
    expect(readCollapsedSection(localStorage, 'settled')).toBe(true)
    expect(readCollapsedSection(localStorage, 'pinned')).toBe(true)
    writeCollapsedSection(localStorage, 'settled', false)
    expect(readCollapsedSection(localStorage, 'settled')).toBe(false)
    expect(readCollapsedSection(localStorage, 'pinned')).toBe(true)
  })

  it('folds each project settled group on its own', () => {
    expect(readProjectSettledCollapsed(localStorage, '/project-a')).toBe(true)
    expect(readProjectSettledCollapsed(localStorage, '/project-b')).toBe(true)
    writeProjectSettledCollapsed(localStorage, '/project-a', false)
    expect(readProjectSettledCollapsed(localStorage, '/project-a')).toBe(false)
    expect(readProjectSettledCollapsed(localStorage, '/project-b')).toBe(true)
    localStorage.setItem(PROJECT_SETTLED_COLLAPSE_KEY, '{')
    expect(readProjectSettledCollapsed(localStorage, '/project-a')).toBe(true)
  })

  it('folds one project when it closes and leaves the other open', () => {
    writeProjectSettledCollapsed(localStorage, '/project-a', false)
    writeProjectSettledCollapsed(localStorage, '/project-b', false)
    foldProjectSettled('/project-a')
    expect(readProjectSettledCollapsed(localStorage, '/project-a')).toBe(true)
    expect(readProjectSettledCollapsed(localStorage, '/project-b')).toBe(false)
  })

  it('starts a reopened project with its settled group folded', () => {
    const first = renderHook(() => useProjectSettledCollapsed('/project-a'))
    expect(first.result.current[0]).toBe(true)
    act(() => first.result.current[1]())
    expect(first.result.current[0]).toBe(false)
    first.unmount()
    foldProjectSettled('/project-a')

    const second = renderHook(() => useProjectSettledCollapsed('/project-a'))
    expect(second.result.current[0]).toBe(true)
  })

  it('stores each section without clearing the other', () => {
    writeCollapsedSection(localStorage, 'pinned', true)
    writeCollapsedSection(localStorage, 'drafts', true)
    writeCollapsedSection(localStorage, 'drafts', false)
    expect(readCollapsedSection(localStorage, 'pinned')).toBe(true)
    expect(readCollapsedSection(localStorage, 'drafts')).toBe(false)
  })

  it('remembers a fold across mounts', () => {
    const first = renderHook(() => useSidebarSectionCollapsed('pinned'))
    expect(first.result.current[0]).toBe(false)
    act(() => first.result.current[1]())
    expect(first.result.current[0]).toBe(true)
    first.unmount()

    const second = renderHook(() => useSidebarSectionCollapsed('pinned'))
    expect(second.result.current[0]).toBe(true)
    expect(readCollapsedSection(localStorage, 'drafts')).toBe(false)
  })

  it('toggles once while StrictMode replays effects', () => {
    const hook = renderHook(() => useSidebarSectionCollapsed('drafts'), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    })
    expect(hook.result.current[0]).toBe(false)
    act(() => hook.result.current[1]())
    expect(hook.result.current[0]).toBe(true)
    hook.unmount()

    const again = renderHook(() => useSidebarSectionCollapsed('drafts'))
    expect(again.result.current[0]).toBe(true)
  })
})
