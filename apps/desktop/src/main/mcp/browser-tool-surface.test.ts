import { afterEach, describe, expect, it } from 'vitest'
import {
  advertisedBrowserToolNames,
  clearBrowserToolSurfaceLock,
  clearBrowserToolSurfaceLocks,
  parseBrowserToolSurface,
  resolveBrowserToolSurface,
  setBrowserToolSurfaceForTests,
} from './browser-tool-surface'

describe('browser tool surface', () => {
  afterEach(() => {
    setBrowserToolSurfaceForTests(null)
    clearBrowserToolSurfaceLocks()
    delete process.env.SUPERONE_BROWSER_TOOLS
  })

  it('parses only the two known surfaces', () => {
    expect(parseBrowserToolSurface('legacy')).toBe('legacy')
    expect(parseBrowserToolSurface('compact')).toBe('compact')
    expect(parseBrowserToolSurface('auto')).toBeNull()
    expect(parseBrowserToolSurface(undefined)).toBeNull()
  })

  it('lets the test override win over env', () => {
    process.env.SUPERONE_BROWSER_TOOLS = 'legacy'
    setBrowserToolSurfaceForTests('compact')
    expect(resolveBrowserToolSurface()).toBe('compact')
  })

  it('honours SUPERONE_BROWSER_TOOLS when no override is set', () => {
    process.env.SUPERONE_BROWSER_TOOLS = 'legacy'
    expect(resolveBrowserToolSurface()).toBe('legacy')
  })

  it('locks the first resolve per sessionId', () => {
    setBrowserToolSurfaceForTests('compact')
    expect(resolveBrowserToolSurface('sess-a')).toBe('compact')
    setBrowserToolSurfaceForTests('legacy')
    expect(resolveBrowserToolSurface('sess-a')).toBe('compact')
    expect(resolveBrowserToolSurface('sess-b')).toBe('legacy')
  })

  it('drops a session lock so the next resolve re-reads the flag', () => {
    setBrowserToolSurfaceForTests('compact')
    expect(resolveBrowserToolSurface('sess-a')).toBe('compact')
    clearBrowserToolSurfaceLock('sess-a')
    setBrowserToolSurfaceForTests('legacy')
    expect(resolveBrowserToolSurface('sess-a')).toBe('legacy')
  })

  it('advertises 8 compact names and 30 legacy names', () => {
    expect(advertisedBrowserToolNames('compact')).toHaveLength(8)
    expect(advertisedBrowserToolNames('legacy')).toHaveLength(30)
    expect(advertisedBrowserToolNames('compact')).toContain('browser_act')
    expect(advertisedBrowserToolNames('legacy')).toContain('browser_click')
    expect(advertisedBrowserToolNames('legacy')).not.toContain('browser_act')
  })
})
