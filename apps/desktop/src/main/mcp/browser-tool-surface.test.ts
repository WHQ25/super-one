import { afterEach, describe, expect, it } from 'vitest'

import {
  advertisedBrowserToolNames,
  parseBrowserToolSurface,
  resolveBrowserToolSurface,
  setBrowserToolSurfaceForTests,
} from './browser-tool-surface'

describe('browser tool surface', () => {
  afterEach(() => {
    setBrowserToolSurfaceForTests(null)
    delete process.env.SUPERONE_BROWSER_TOOLS
  })

  it('defaults to the compact surface', () => {
    expect(resolveBrowserToolSurface()).toBe('compact')
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

  it('honours SUPERONE_BROWSER_TOOLS as the legacy escape hatch', () => {
    process.env.SUPERONE_BROWSER_TOOLS = 'legacy'
    expect(resolveBrowserToolSurface()).toBe('legacy')
  })

  it('ignores an unrecognised env value and stays compact', () => {
    process.env.SUPERONE_BROWSER_TOOLS = 'classic'
    expect(resolveBrowserToolSurface()).toBe('compact')
  })

  it('includes both WebMCP tools in both browser surfaces', () => {
    expect(advertisedBrowserToolNames('compact')).toHaveLength(11)
    expect(advertisedBrowserToolNames('legacy')).toHaveLength(34)
    expect(advertisedBrowserToolNames('compact')).toContain('browser_act')
    expect(advertisedBrowserToolNames('compact')).toContain('browser_tools_list')
    expect(advertisedBrowserToolNames('compact')).toContain('browser_tools_call')
    expect(advertisedBrowserToolNames('legacy')).toContain('browser_click')
    expect(advertisedBrowserToolNames('legacy')).toContain('browser_tools_list')
    expect(advertisedBrowserToolNames('legacy')).toContain('browser_tools_call')
    expect(advertisedBrowserToolNames('legacy')).not.toContain('browser_act')
  })
})
