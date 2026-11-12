import { describe, expect, it } from 'vitest'
import { mcpResourceSummaryText, parseMcpResourceBlock } from './mcp-resource-display'

describe('parseMcpResourceBlock', () => {
  it('parses structured JSON resource lists and empty resource outputs', () => {
    const listInfo = parseMcpResourceBlock(
      'ListMcpResources',
      { ServerName: 'context7' },
      JSON.stringify({
        resources: [
          { uri: 'mcp://context7/react', name: 'React Docs', mimeType: 'text/markdown', description: 'Hooks guide' },
        ],
      }),
    )
    expect(listInfo.action).toBe('list')
    expect(listInfo.server).toBe('context7')
    expect(listInfo.resources).toEqual([
      { uri: 'mcp://context7/react', name: 'React Docs', mimeType: 'text/markdown', description: 'Hooks guide' },
    ])
    expect(listInfo.emptyList).toBe(false)

    const emptyInfo = parseMcpResourceBlock('list_resources', { server: 'agent-memory' }, 'No resources found.')
    expect(emptyInfo.emptyList).toBe(true)
    expect(emptyInfo.resources).toEqual([])
  })

  it('unwraps Antigravity Resource (<uri>): header and offloaded path on ReadMcpResource', () => {
    const readInfo = parseMcpResourceBlock(
      'ReadMcpResource',
      { server: 'context7' },
      'Resource (mcp://context7/react):\n# Hooks\n[Resource offloaded to /tmp/resource.bin]',
    )
    expect(readInfo.action).toBe('read')
    expect(readInfo.uri).toBe('mcp://context7/react')
    expect(readInfo.contentText).toBe('# Hooks')
    expect(readInfo.offloadedPath).toBe('/tmp/resource.bin')
    expect(mcpResourceSummaryText('ReadMcpResource', { server: 'context7', uri: 'mcp://context7/react' })).toBe(
      'context7 · mcp://context7/react',
    )
  })
})
