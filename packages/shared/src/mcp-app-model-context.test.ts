import { describe, expect, it } from 'vitest'
import { mcpAppContextItems, mcpAppContextState, removeMcpAppContextBlock } from './mcp-app-model-context'
import { mcpAppContextSources, mcpAppModelContextInput, mcpAppModelInput, mergeMcpAppAttachment, updateMcpAppAttachments } from './mcp-apps-state'
import type { ToolAppAttachment } from './mcp-apps'

const visible = { type: 'text', text: '{"part":"dial"}', _meta: { 'openai/title': 'Agent dial', private: 'block-private', 'openai/thumbnail': { src: 'https://example.com/dial.png' } } }
const hidden = { type: 'text', text: 'Model background', annotations: { audience: ['assistant'] }, _meta: { private: 'hidden-private' } }
const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'CAD', configGeneration: 1, configFingerprint: 'config' }, status: 'result', resourceUri: 'ui://cad', presentation: { toolTitle: 'Library', serverTitle: 'Fixture CAD', icons: [{ src: 'https://example.com/icon.png' }] }, modelContext: { updateId: 'update-1', content: [visible, hidden, { type: 'text', text: 'Another block' }], structuredContent: { selected: 'dial' }, source: { appInstanceId: 'forged', server: 'forged' } } }
const message = (value: ToolAppAttachment) => ({ id: 'm', content: [{ type: 'tool_result' as const, toolUseId: 'call', summary: '', app: value }] })

describe('persistent composer model context', () => {
  it('drops a repeated source name from derived titles but keeps explicit titles and content', () => {
    const titles = (blocks: unknown[]) => mcpAppContextItems({ ...app, modelContext: { updateId: 'u', content: blocks } }, 'm').map(item => item.title)
    expect(titles([{ type: 'text', text: 'Fixture CAD selected view: {"part":"dial"}' }])).toEqual(['selected view'])
    expect(titles([{ type: 'text', text: 'fixture cad — dial' }])).toEqual(['dial'])
    expect(titles([{ type: 'text', text: 'Fixture CADence notes' }])).toEqual(['Fixture CADence notes'])
    expect(titles([{ type: 'text', text: 'Fixture CAD' }])).toEqual(['Fixture CAD'])
    expect(titles([{ type: 'text', text: 'x', _meta: { 'openai/title': 'Fixture CAD dial' } }])).toEqual(['Fixture CAD dial'])
    const [item] = mcpAppContextItems({ ...app, modelContext: { updateId: 'u', content: [{ type: 'text', text: 'Fixture CAD selected view: {}' }] } }, 'm')
    expect(item?.content).toBe('Fixture CAD selected view: {}')
  })
  it('titles structured data by its label, or by its field count when it has none', () => {
    const items = (text: string) => mcpAppContextItems({ ...app, modelContext: { updateId: 'u', content: [{ type: 'text', text }] } }, 'm')
    expect(items('selected view: {"page":"viewer","dirty":false,"part":"dial"}')[0]).toMatchObject({ title: 'selected view', content: 'selected view: {"page":"viewer","dirty":false,"part":"dial"}' })
    expect(items('{"page":"viewer","part":"dial"}')[0]).toMatchObject({ title: '2 fields', fields: 2 })
    expect(items('[1]')[0]).toMatchObject({ title: '1 field', fields: 1 })
    expect(items('Picked {not json} here')[0]?.title).toBe('Picked {not json} here')
    expect(items('selected view: {"part":"dial"}')[0]?.fields).toBeUndefined()
  })

  it('shows each visible block, safe thumbnail and bounded text; hides background while a block is visible', () => {
    const items = mcpAppContextItems(app, 'm')
    expect(items.map(item => item.blockIndex)).toEqual([0, 2])
    expect(items[0]).toMatchObject({ source: 'Fixture CAD', title: 'Agent dial', thumbnail: 'https://example.com/dial.png', updateId: 'update-1' })
    expect(items.some(item => item.content?.includes('Model background'))).toBe(false)
    const long = { ...app, modelContext: { ...app.modelContext!, content: [{ type: 'text', text: '中'.repeat(3000) }] } }
    expect(new TextEncoder().encode(mcpAppContextItems(long, 'm')[0].content).length).toBeLessThanOrEqual(4096)
  })

  it('provides one removable App context chip when only hidden blocks or structured fields remain', () => {
    for (const content of [[hidden], []]) {
      const value = { ...app, modelContext: { ...app.modelContext!, content } }
      const [item] = mcpAppContextItems(value, 'm')
      expect(item).toMatchObject({ title: 'Fixture CAD context', icon: 'https://example.com/icon.png' })
      expect(item.blockIndex).toBeUndefined()
      expect(item.content).toContain('selected')
      expect(removeMcpAppContextBlock(value, item.updateId)).toBeNull()
    }
  })

  it('removes one block, rejects stale/hidden removals, and clears background with the last visible block', () => {
    const partial = removeMcpAppContextBlock(app, 'update-1', 0)!
    expect(partial.content).toHaveLength(2)
    expect(partial.structuredContent).toEqual({ selected: 'dial' })
    expect(removeMcpAppContextBlock({ ...app, modelContext: partial }, 'update-1', 1)).toBeNull()
    expect(() => removeMcpAppContextBlock(app, 'old', 0)).toThrow('changed')
    expect(() => removeMcpAppContextBlock(app, 'update-1', 1)).toThrow('unavailable')
  })

  it('keeps background and real images in every model send, excludes all block metadata and raw blobs', () => {
    const value = { ...app, modelContext: { ...app.modelContext!, content: [visible, hidden, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', _meta: { 'openai/title': 'Drawing', secret: 'image-private' } }, { type: 'resource', resource: { uri: 'file:///part.bin', mimeType: 'application/octet-stream', blob: 'YmluYXJ5', _meta: { secret: 'resource-private' } } }] } }
    const context = mcpAppModelContextInput([message(value)])
    for (let i = 0; i < 2; i++) {
      const input = mcpAppModelInput({ text: 'question', images: [] }, context)
      expect(input.text).toContain('Model background')
      expect(input.text).toContain('"server":"CAD"')
      expect(input.text).toContain('byteSize')
      expect(input.text).not.toMatch(/private|YmluYXJ5|iVBORw0KGgo|forged|openai\/title/)
      expect(input.images).toMatchObject([{ mimeType: 'image/png', base64: 'iVBORw0KGgo=' }])
    }
  })

  it('persists null as an authoritative clear and never resurrects it from a provider delta', () => {
    const cleared = updateMcpAppAttachments([message(app)], 'view', { modelContext: null })
    expect(mcpAppModelContextInput(cleared)).toEqual({ text: '', images: [] })
    expect(mergeMcpAppAttachment(cleared[0].content![0].app, app)?.modelContext).toBeNull()
    expect(mcpAppContextState(cleared[0].content![0].app!)).toBeNull()
  })

  it('restores complete context outside loaded transcript pages without copying HTML or private tool data', () => {
    const sources = mcpAppContextSources([message({ ...app, resource: { html: 'html', hash: 'hash', meta: {} }, toolResult: { content: [], _meta: { private: 'tool-private' } } })])
    expect(sources[0].app.resource).toBeUndefined()
    expect(sources[0].app.toolResult).toBeUndefined()
    expect(mcpAppContextItems(sources[0].app, 'm')).toHaveLength(2)
  })
})
