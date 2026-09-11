/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const state = {
  mcpMeta: {} as Record<string, { name?: string; icons?: { src?: string }[] }>,
  mcpMetaCache: {} as Record<string, { name?: string; icons?: { src?: string }[] }>,
  mcpLibrary: [] as Array<{ name: string; icons?: { src?: string }[] }>,
  mcpbInstalled: [] as Array<{ meta: { name: string }; iconDataUrl?: string }>,
}

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

const { useMcpServerIcon } = await import('./use-mcp-server-icon')

describe('useMcpServerIcon', () => {
  it('resolves Claude mcp__ names and Grok GitHub casing from the same sources', () => {
    state.mcpLibrary = [{ name: 'github', icons: [{ src: 'https://example.com/g.png' }] }]
    expect(renderHook(() => useMcpServerIcon('github')).result.current).toBe('https://example.com/g.png')
    expect(renderHook(() => useMcpServerIcon('GitHub')).result.current).toBe('https://example.com/g.png')
  })

  it('lets live meta override the library', () => {
    state.mcpLibrary = [{ name: 'linear', icons: [{ src: 'lib.png' }] }]
    state.mcpMeta = { linear: { name: 'linear', icons: [{ src: 'live.png' }] } }
    expect(renderHook(() => useMcpServerIcon('linear')).result.current).toBe('live.png')
  })
})
