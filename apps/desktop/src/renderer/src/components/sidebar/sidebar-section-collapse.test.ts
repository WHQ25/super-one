/** @vitest-environment jsdom */

import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SIDEBAR_SECTION_COLLAPSE_KEY,
  readCollapsedSection,
  useSidebarSectionCollapsed,
  writeCollapsedSection,
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
