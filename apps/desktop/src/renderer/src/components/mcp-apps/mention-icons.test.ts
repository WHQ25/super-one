/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpMentionSource } from '@superone/shared/mcp-app-mentions'

const source = (server: string, icon?: string): McpMentionSource => ({ server, tool: 'search', title: server, items: [], ...(icon ? { icon } : {}) })

async function fresh() {
  vi.resetModules()
  return import('./mention-icons')
}

describe('MCP mention icon cache', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the newest icon per server across reloads and ignores sources without one', async () => {
    const first = await fresh()
    first.rememberMcpMentionIcons([source('bits', 'data:a'), source('plain')])
    first.rememberMcpMentionIcons([source('bits', 'data:b')])
    const reloaded = await fresh()
    expect(JSON.parse(localStorage.getItem('superone.mcpMentionIcons')!)).toEqual({ bits: 'data:b' })
    const { result } = await import('@testing-library/react').then(({ renderHook }) => renderHook(() => reloaded.useMcpMentionIcon('bits')))
    expect(result.current).toBe('data:b')
  })

  it('drops the servers seen longest ago past the cap', async () => {
    const { rememberMcpMentionIcons } = await fresh()
    for (let i = 0; i < 40; i++) rememberMcpMentionIcons([source(`s${i}`, `data:${i}`)])
    rememberMcpMentionIcons([source('s10', 'data:new')])
    const stored = JSON.parse(localStorage.getItem('superone.mcpMentionIcons')!) as Record<string, string>
    expect(Object.keys(stored)).toHaveLength(32)
    expect(stored.s0).toBeUndefined()
    expect(stored.s10).toBe('data:new')
    expect(Object.keys(stored).at(-1)).toBe('s10')
  })

  it('starts empty when the stored value is corrupt', async () => {
    localStorage.setItem('superone.mcpMentionIcons', '{nope')
    const { useMcpMentionIcon } = await fresh()
    const { renderHook } = await import('@testing-library/react')
    expect(renderHook(() => useMcpMentionIcon('bits')).result.current).toBeUndefined()
  })
})
