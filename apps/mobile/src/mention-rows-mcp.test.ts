import { describe, expect, it } from 'vitest'
import type { McpMentionSource } from '@superone/shared/mcp-app-mentions'
import { buildMentionRows, groupMentionRows } from './mention-rows'

const bits: McpMentionSource = {
  server: 'bits', tool: 'search_parts', title: 'Bits CAD',
  items: [{ uri: 'cad://parts/hex-bolt', label: 'Hex bolt', detail: 'M6 hex bolt' }],
}

describe('MCP server items', () => {
  it('lists each item under its server, with the query marked in name and detail', () => {
    const rows = buildMentionRows('hex', { remote: [], agentProfiles: [], mcp: [bits] })
    const row = rows.find((candidate) => candidate.item.kind === 'mcp-resource')
    expect(row).toMatchObject({
      item: { kind: 'mcp-resource', path: 'bits:cad://parts/hex-bolt', label: 'Hex bolt', mcpGroup: 'mcp:bits/search_parts' },
      label: 'Hex bolt', labelIndices: [0, 1, 2], hint: 'M6 hex bolt', hintIndices: [3, 4, 5],
    })
  })

  it('puts server sections before files, as the desktop popup does', () => {
    const rows = buildMentionRows('hex', { remote: [{ kind: 'file', path: 'src/hex.ts' }], agentProfiles: [], mcp: [bits] })
    const keys = groupMentionRows(rows).map((group) => group.key)
    expect(keys.indexOf('mcp:bits/search_parts')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('mcp:bits/search_parts')).toBeLessThan(keys.indexOf('file'))
  })
})
