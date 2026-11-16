/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import {
  forgetModTheme,
  getModThemeCache,
  recallModTheme,
  rememberModTheme,
  resetModThemeCacheForTests,
} from './mod-theme-cache'

function backdrop(id: string): ModBackdropSnapshot {
  return {
    result: { hooked: true, tree: { type: 'Text', props: {}, children: [id] }, props: { id } },
    props: {},
  } as ModBackdropSnapshot
}

const project = '/repo'

function shownId(key: { sessionId?: string | null; projectPath?: string | null }): unknown {
  return recallModTheme(getModThemeCache(), key).backdrop?.result.props.id ?? null
}

afterEach(() => {
  resetModThemeCacheForTests()
})

describe('mod theme first-frame cache', () => {
  it('recalls what a session showed, and its project for a session that showed nothing yet', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    expect(shownId({ sessionId: 'a', projectPath: project })).toBe('reef')
    expect(shownId({ sessionId: 'new', projectPath: project })).toBe('reef')
    expect(shownId({ projectPath: `${project}/` })).toBe('reef')
    expect(shownId({ sessionId: 'b', projectPath: '/other' })).toBeNull()
  })

  it('keeps a session on its own theme when another session changes the project', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    rememberModTheme({ sessionId: 'b', projectPath: project }, 'backdrop', backdrop('dunes'))
    expect(shownId({ sessionId: 'a', projectPath: project })).toBe('reef')
    expect(shownId({ sessionId: 'new', projectPath: project })).toBe('dunes')
  })

  it('shows nothing in a session whose mod took the theme away, while the project keeps a newer one', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    rememberModTheme({ sessionId: 'b', projectPath: project }, 'backdrop', backdrop('dunes'))
    forgetModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    expect(shownId({ sessionId: 'a', projectPath: project })).toBeNull()
    expect(shownId({ sessionId: 'new', projectPath: project })).toBe('dunes')
  })

  it('forgets the project theme a session took away when the project still held it', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    forgetModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    expect(shownId({ sessionId: 'new', projectPath: project })).toBeNull()
    expect(getModThemeCache().project).toEqual({})
  })

  it('keeps theme colors and backdrop apart', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'theme', { colors: { background: '#111111' } })
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    forgetModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    const recalled = recallModTheme(getModThemeCache(), { sessionId: 'a', projectPath: project })
    expect(recalled.backdrop).toBeNull()
    expect(recalled.theme).toEqual({ colors: { background: '#111111' } })
  })

  it('does not let a remote project share a local project theme', () => {
    rememberModTheme({ projectPath: project }, 'backdrop', backdrop('local'))
    expect(shownId({ projectPath: `remote:host-1:${project}` })).toBeNull()
  })

  it('does not rewrite storage for the same theme drawn again', () => {
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    const before = getModThemeCache()
    rememberModTheme({ sessionId: 'a', projectPath: project }, 'backdrop', backdrop('reef'))
    expect(getModThemeCache()).toBe(before)
  })

  it('keeps only the most recent sessions', () => {
    for (let i = 0; i < 205; i++) rememberModTheme({ sessionId: `s${i}` }, 'backdrop', backdrop(`t${i}`))
    const sessions = Object.keys(getModThemeCache().session)
    expect(sessions).toHaveLength(200)
    expect(sessions).not.toContain('s0')
    expect(sessions).toContain('s204')
  })
})
