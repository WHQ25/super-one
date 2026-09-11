import { describe, expect, it } from 'vitest'
import { clearMcpIconsForTests, loadMcpIcons, mcpIconsRevision, mcpIconsSnapshot } from './mcp-icons'

describe('loadMcpIcons', () => {
  it('stores the host map and bumps revision only when it changes', async () => {
    clearMcpIconsForTests()
    const start = mcpIconsRevision()
    const client = {
      request: async () => ({ icons: { github: 'https://example.com/g.png' } }),
    }
    await loadMcpIcons(client, '/repo')
    expect(mcpIconsSnapshot()).toEqual({ github: 'https://example.com/g.png' })
    expect(mcpIconsRevision()).toBe(start + 1)
    await loadMcpIcons(client)
    expect(mcpIconsRevision()).toBe(start + 1)
  })

  it('ignores a missing or failing host command', async () => {
    clearMcpIconsForTests()
    await loadMcpIcons({ request: async () => { throw new Error('unknown command') } })
    expect(mcpIconsSnapshot()).toEqual({})
    await loadMcpIcons({ request: async () => ({ error: 'unsupported' }) })
    expect(mcpIconsSnapshot()).toEqual({})
  })
})
