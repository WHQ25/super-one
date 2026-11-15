/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import {
  getModThemeCache,
  resetModThemeCacheForTests,
  resolveModTheme,
  writeModTheme,
} from './mod-theme-cache'

function backdrop(id: string, scope?: string): ModBackdropSnapshot {
  return {
    result: { hooked: true, tree: { type: 'Text', props: {} }, props: { id, ...(scope ? { scope } : {}) } },
    props: {},
  } as ModBackdropSnapshot
}

const project = '/repo'
const otherProject = '/other'
const folder = '/repo/pkg'
const otherFolder = '/repo/apps'

afterEach(() => {
  resetModThemeCacheForTests()
})

describe('mod theme scope isolation', () => {
  it('uses folder, project, then harness when there is no session yet', () => {
    writeModTheme({ scope: 'harness', backdrop: backdrop('all') })
    writeModTheme({ scope: 'project', projectPath: project, backdrop: backdrop('repo') })
    writeModTheme({ scope: 'folder', projectPath: project, folderPath: folder, backdrop: backdrop('pkg') })
    writeModTheme({ scope: 'session', sessionId: 'old', projectPath: project, folderPath: folder, backdrop: backdrop('own') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { projectPath: project, folderPath: folder }).scope).toBe('folder')
    expect(resolveModTheme(cache, { projectPath: project, folderPath: otherFolder }).scope).toBe('project')
    expect(resolveModTheme(cache, { projectPath: otherProject }).scope).toBe('harness')
    expect(resolveModTheme(cache, { sessionId: 'old', projectPath: project, folderPath: folder }).scope).toBe('session')
  })

  it('keeps a session theme on that session', () => {
    writeModTheme({ scope: 'session', sessionId: 'a', projectPath: project, folderPath: folder, backdrop: backdrop('a') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'a', projectPath: project, folderPath: folder }).backdrop?.result.props).toMatchObject({ id: 'a' })
    expect(resolveModTheme(cache, { sessionId: 'b', projectPath: project, folderPath: folder }).backdrop).toBeNull()
    expect(resolveModTheme(cache, { sessionId: 'b', projectPath: project, folderPath: folder }).scope).toBeNull()
  })

  it('does not copy a scopeless write onto the project or the harness', () => {
    writeModTheme({ scope: 'session', sessionId: 'a', projectPath: project, folderPath: folder, backdrop: backdrop('a'), themeProps: { colors: { background: '#fff' } } })
    const cache = getModThemeCache()
    expect(cache.project).toEqual({})
    expect(cache.folder).toEqual({})
    expect(cache.harness).toBeNull()
  })

  it('keeps a folder theme off other folders and the parent project path', () => {
    writeModTheme({ scope: 'folder', projectPath: project, folderPath: folder, backdrop: backdrop('pkg', 'folder') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'a', projectPath: project, folderPath: folder }).scope).toBe('folder')
    expect(resolveModTheme(cache, { sessionId: 'b', projectPath: project, folderPath: otherFolder }).backdrop).toBeNull()
    expect(resolveModTheme(cache, { sessionId: 'c', projectPath: project, folderPath: `${folder}/src` }).backdrop).toBeNull()
    expect(resolveModTheme(cache, { sessionId: 'd', projectPath: `remote:host-2:${project}`, folderPath: folder }).backdrop).toBeNull()
  })

  it('keeps a project theme inside that project', () => {
    writeModTheme({ scope: 'project', projectPath: project, backdrop: backdrop('repo', 'project') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'a', projectPath: `${project}/`, folderPath: folder }).scope).toBe('project')
    expect(resolveModTheme(cache, { sessionId: 'b', projectPath: otherProject, folderPath: otherProject }).backdrop).toBeNull()
  })

  it('keeps a harness theme off a session, folder, or project that opted out', () => {
    writeModTheme({ scope: 'harness', backdrop: backdrop('all', 'harness'), themeProps: { colors: { background: '#111' } } })
    writeModTheme({ scope: 'session', sessionId: 'own', clear: true })
    writeModTheme({ scope: 'folder', projectPath: project, folderPath: folder, clear: true })
    writeModTheme({ scope: 'project', projectPath: otherProject, clear: true })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'plain', projectPath: project, folderPath: otherFolder }).scope).toBe('harness')
    expect(resolveModTheme(cache, { sessionId: 'own', projectPath: project, folderPath: otherFolder }).scope).toBeNull()
    expect(resolveModTheme(cache, { sessionId: 'in-folder', projectPath: project, folderPath: folder }).scope).toBeNull()
    expect(resolveModTheme(cache, { sessionId: 'other', projectPath: otherProject, folderPath: otherProject }).scope).toBeNull()
  })

  it('prefers session over folder over project over harness', () => {
    writeModTheme({ scope: 'harness', backdrop: backdrop('h') })
    writeModTheme({ scope: 'project', projectPath: project, backdrop: backdrop('p') })
    writeModTheme({ scope: 'folder', projectPath: project, folderPath: folder, backdrop: backdrop('f') })
    writeModTheme({ scope: 'session', sessionId: 'a', projectPath: project, folderPath: folder, backdrop: backdrop('s') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'a', projectPath: project, folderPath: folder }).scope).toBe('session')
    expect(resolveModTheme(cache, { sessionId: 'b', projectPath: project, folderPath: folder }).scope).toBe('folder')
    expect(resolveModTheme(cache, { sessionId: 'c', projectPath: project, folderPath: otherFolder }).scope).toBe('project')
    expect(resolveModTheme(cache, { sessionId: 'd', projectPath: otherProject, folderPath: otherProject }).scope).toBe('harness')
  })

  it('does not let a remote project share a local project theme', () => {
    writeModTheme({ scope: 'project', projectPath: project, backdrop: backdrop('local') })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'r', projectPath: `remote:host-1:${project}`, folderPath: project }).backdrop).toBeNull()
  })

  it('drops an empty session slot without blocking a wider theme', () => {
    writeModTheme({ scope: 'project', projectPath: project, backdrop: backdrop('p') })
    writeModTheme({ scope: 'session', sessionId: 'a', projectPath: project, backdrop: backdrop('s') })
    writeModTheme({ scope: 'session', sessionId: 'a', projectPath: project, backdrop: null, themeProps: null })
    const cache = getModThemeCache()
    expect(resolveModTheme(cache, { sessionId: 'a', projectPath: project, folderPath: folder }).scope).toBe('project')
  })
})
